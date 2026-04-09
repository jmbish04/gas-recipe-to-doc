/**
 * @fileoverview Cloudflare AI Gateway & Agent Execution Loop
 * @module services/aiGateway
 * @description Orchestrates AI calls through AI Gateway compatibility mode for primary and fallback attempts.
 */

/**
 * Tool Dispatch Map for Agentic Workflow
 */
const TOOL_DISPATCHER = {
  'search_web': function(args) {
    return searchGoogleCustom(args.query);
  },
  'search_image': function(args) {
    return findRecipeImage(args.title) || "No image found.";
  },
  'create_recipe_doc': function(args) {
    const docRes = JSON.parse(createRecipeDoc(args));
    return "Document created successfully: " + docRes.url;
  },
  'capture_recipe_data': function(args) {
    return captureRecipeData(args.url);
  }
};

/**
 * Entry point for AI conversation steps with automated recovery.
 * @param {Array} messages - Prior conversation context.
 * @returns {string} Serialized JSON response.
 */
function chatWithAI_step(messages) {
  let fullMessages = messages || [];
  
  // Ensure System Prompt is initialized
  if (fullMessages.length === 0 || fullMessages[0].role !== 'system') {
    fullMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  }

  try {
    // Primary Attempt via AI Gateway
    return executeAgentStep(fullMessages, false);
  } catch (error) {
    console.warn(`[RECOVERY] Primary AI failed: ${error.message}. Initiating AI Gateway fallback...`);
    
    try {
      // Fallback Attempt via AI Gateway (OpenAI Compat Mode)
      return executeAgentStep(fullMessages, true);
    } catch (fallbackError) {
      console.error(`[CRITICAL] All AI providers exhausted: ${fallbackError.message}`);
      throw fallbackError;
    }
  }
}

/**
 * Executes a single inference step using the AI Gateway Compatibility endpoint.
 * @param {Array} messages - Message history.
 * @param {boolean} isFallback - Whether to use the fallback model.
 */
function executeAgentStep(messages, isFallback = false) {
  const model = isFallback ? CONFIG.AI_MODEL_FALLBACK_NAME : CONFIG.AI_MODEL;
  
  // Sanitize message structure for OpenAI compatibility
  const sanitizedMessages = messages.map(msg => ({
    role: msg.role,
    content: Array.isArray(msg.content) 
      ? msg.content.map(c => c.text || '').join('') 
      : (msg.content || ""),
    ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
    ...(msg.name ? { name: msg.name } : {})
  }));

  const endpointUrl = CONFIG.CLOUDFLARE_AI_GATEWAY_URL;
  const headers = { 
    "cf-aig-authorization": `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`,
    "Content-Type": "application/json"
  };

  const payload = {
    model: model,
    messages: sanitizedMessages,
    tools: TOOLS,
    tool_choice: "auto",
    response_format: RESPONSE_FORMAT,
    temperature: 0.5
  };

  const response = UrlFetchApp.fetch(endpointUrl, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  
  if (code !== 200) {
    throw new Error(`AI_GATEWAY_ERROR_${code}: ${text}`);
  }

  const parsed = JSON.parse(text);
  const aiMessage = parsed.choices[0].message;

  // Intercept and hydrate 'propose_recipes' for Generative UI
  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    const proposeCall = aiMessage.tool_calls.find(tc => tc.function.name === 'propose_recipes');
    
    if (proposeCall) {
      const args = JSON.parse(proposeCall.function.arguments);
      const recipes = enrichRecipesWithImages(args.recipes || []);

      return JSON.stringify({
        type: "final",
        response: {
          message: "I have prepared three specialized recipe options for you.",
          proposals: recipes,
          doc_url: ""
        }
      });
    }

    // Recursively handle other tool calls (search_web, etc.)
    return handleToolCalls(aiMessage, sanitizedMessages);
  }

  // Final structured response serialization
  return finalizeOutput(aiMessage.content);
}

/**
 * Internal utility to process tool outputs and return to the AI loop.
 */
function handleToolCalls(aiMessage, history) {
  history.push(aiMessage);
  
  aiMessage.tool_calls.forEach(call => {
    const toolName = call.function.name;
    const args = JSON.parse(call.function.arguments);
    let result;

    try {
      result = TOOL_DISPATCHER[toolName] ? TOOL_DISPATCHER[toolName](args) : `Error: Tool ${toolName} not found.`;
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

  return executeAgentStep(history, false); 
}

/**
 * Ensures terminal output matches the frontend schema.
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
