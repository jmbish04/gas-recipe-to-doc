/**
 * @fileoverview Refactored Cloudflare AI Gateway & Agent Execution Loop
 * Targets: Google Apps Script (V8)
 * Stack: Hono (Routing Pattern), Cloudflare Workers AI
 */

/**
 * Orchestrates the conversation and manages the failover state.
 */
function chatWithAI_step(messages) {
  let fullMessages = messages || [];
  
  // Ensure System Prompt is present
  if (fullMessages.length === 0 || fullMessages[0].role !== 'system') {
    fullMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  }

  try {
    // Primary Attempt: AI Gateway (OpenAI Compatible)
    return executeAgentStep(fullMessages, false);
  } catch (error) {
    console.warn(`[RECOVERY] Primary AI failed: ${error.message}. Initiating Fallback...`);
    
    // Self-Healing: Internal Retry with Fallback Model
    try {
      return executeAgentStep(fullMessages, true);
    } catch (fallbackError) {
      console.error(`[CRITICAL] All AI providers exhausted: ${fallbackError.message}`);
      throw fallbackError;
    }
  }
}

/**
 * Executes a single inference step.
 * Handles structural differences between AI Gateway (OpenAI-style) and Workers AI (Direct REST).
 */
function executeAgentStep(messages, isFallback = false) {
  const model = isFallback ? CONFIG.AI_MODEL_FALLBACK_NAME : CONFIG.AI_MODEL;
  
  // Sanitize message content for consistency
  const sanitizedMessages = messages.map(msg => ({
    role: msg.role,
    content: Array.isArray(msg.content) 
      ? msg.content.map(c => c.text || '').join('') 
      : (msg.content || ""),
    ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
    ...(msg.name ? { name: msg.name } : {})
  }));

  // Construct endpoint and headers
  let endpointUrl, headers, payload;

  if (isFallback) {
    // Workers AI Direct REST API Schema
    const modelId = model.replace('workers-ai/', '');
    endpointUrl = `${CONFIG.CLOUDFLARE_WORKERS_AI_URL}/${modelId}`;
    headers = { 
      "Authorization": `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`,
      "Content-Type": "application/json"
    };
    payload = {
      messages: sanitizedMessages,
      tools: TOOLS,
      max_tokens: 1024 // Essential for larger models like Llama 3.3
    };
  } else {
    // AI Gateway OpenAI-Compatible Schema
    endpointUrl = CONFIG.CLOUDFLARE_AI_GATEWAY_URL;
    headers = { 
      "cf-aig-authorization": `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`,
      "Content-Type": "application/json"
    };
    payload = {
      model: model,
      messages: sanitizedMessages,
      tools: TOOLS,
      tool_choice: "auto",
      response_format: RESPONSE_FORMAT,
      temperature: 0.5
    };
  }

  const response = UrlFetchApp.fetch(endpointUrl, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  
  if (code !== 200) {
    throw new Error(`AI_API_ERROR_${code}: ${text}`);
  }

  const parsed = JSON.parse(text);
  let aiMessage;

  // Normalize response structure
  if (isFallback) {
    if (!parsed.success) throw new Error(`Workers AI Error: ${JSON.stringify(parsed.errors)}`);
    // Workers AI returns { result: { response, tool_calls } }
    const result = parsed.result;
    aiMessage = {
      role: "assistant",
      content: result.response || "",
      tool_calls: (result.tool_calls || []).map(tc => ({
        id: `call_${Utilities.getUuid().split('-')[0]}`, // Generate ID for local state tracking
        type: "function",
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
        }
      }))
    };
  } else {
    // OpenAI style: { choices: [{ message }] }
    aiMessage = parsed.choices[0].message;
  }

  // Tool Selection Logic
  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    return handleToolCalls(aiMessage, sanitizedMessages);
  }

  // Final Serialization
  return finalizeOutput(aiMessage.content);
}

/**
 * Handles tool call execution and recursion.
 */
function handleToolCalls(aiMessage, history) {
  history.push(aiMessage);
  
  aiMessage.tool_calls.forEach(call => {
    const toolName = call.function.name;
    const args = JSON.parse(call.function.arguments);
    let result;

    try {
      if (TOOL_DISPATCHER[toolName]) {
        result = TOOL_DISPATCHER[toolName](args);
      } else {
        result = `Error: Tool ${toolName} not found.`;
      }
    } catch (e) {
      result = `Error executing ${toolName}: ${e.message}`;
    }

    history.push({
      role: "tool",
      tool_call_id: call.id,
      name: toolName,
      content: String(result)
    });
  });

  // Recursive call to get the next model response after tool results
  return executeAgentStep(history, false); 
}

/**
 * Ensures output strictly follows the RESPONSE_FORMAT.
 */
function finalizeOutput(content) {
  try {
    const data = JSON.parse(content);
    return JSON.stringify({ type: "final", response: data });
  } catch (e) {
    return JSON.stringify({
      type: "final",
      response: { message: content, proposals: [], doc_url: "" }
    });
  }
}
