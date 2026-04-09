/**
 * @fileoverview Cloudflare AI Gateway & Agent Execution Loop
 * @module services/aiGateway
 * @description Orchestrates the communication with the Cloudflare AI Gateway.
 * Implements a recursive, self-healing execution loop to handle autonomous tool calling and structured data serialization.
 */

/**
 * Initializes the AI conversation and serves as the primary entry point for client RPC calls.
 * @param {Array} messages - Array of prior {role, content} conversation objects.
 * @returns {string} The serialized JSON response matching the strict RESPONSE_FORMAT schema.
 */
function chatWithAI_step(messages, isFallback = false) {
  // If this is the first message in the flow, prepend the static system prompt.
  let fullMessages = messages;
  if (!messages || messages.length === 0 || messages[0].role !== 'system') {
    fullMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ];
  }

  // Extract the most recent user message from the array for auditing purposes.
  const lastUserMsg = [...messages].reverse().find(function(m) { return m.role === 'user'; });

  // If a valid user message exists and we are at the start of a flow (only system + user message)
  if (lastUserMsg && fullMessages.length === 2) {
    try {
        _logToSheet_('chat', 'User Input', lastUserMsg.content, '');
    } catch (e) {}
  }

  // Pass the enriched message array into the step execution engine.
  return executeAgentStep(fullMessages, isFallback);
}

// Tool Dispatch Map definition for better code maintainability
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
 * Recursively resolves tool calls from the AI model until a final structured output is reached.
 * @param {Array} messages - The cumulative message history including tool request/response pairs.
 * @param {number} depth - The current recursion depth to prevent infinite loops (Circuit Breaker).
 * @returns {string} The final JSON string payload.
 */
function executeAgentStep(messages, isFallback = false) {
  let actualModel = isFallback ? CONFIG.AI_MODEL_FALLBACK_NAME : CONFIG.AI_MODEL;

  let sanitizedMessages = messages.map(function(msg) {
    let newMsg = Object.assign({}, msg);
    if (newMsg.content === null || newMsg.content === undefined) {
      newMsg.content = "";
    } else if (Array.isArray(newMsg.content)) {
      newMsg.content = newMsg.content.map(function(c) { return c.text || ''; }).join('');
    } else if (typeof newMsg.content !== 'string') {
      newMsg.content = String(newMsg.content);
    }
    return newMsg;
  });

  const payload = {
    model: actualModel,
    messages: sanitizedMessages,
    tools: TOOLS,
    tool_choice: "auto",
    response_format: RESPONSE_FORMAT,
    temperature: 0.5
  };

  let endpointUrl = CONFIG.CLOUDFLARE_AI_GATEWAY_URL;
  let headers = {
    'cf-aig-authorization': `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`
  };

  if (isFallback) {
      actualModel = `${actualModel.replace('workers-ai/', '')}`; // Cloudflare API (ai/run) does not prepend models with `workers-ai`.
      endpointUrl = `${CLOUDFLARE_WORKERS_AI_URL}/${actualModel}`;
      headers = {
          'Authorization': `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`
      };
    
      console.log(`[executeAgentStep] workers-ai fallback model: "${CONFIG.AI_MODEL_FALLBACK_NAME}"; Running as ${endpointUrl}`);    
    
      delete payload.model;
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(endpointUrl, options);

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    if (!isFallback) {
      return JSON.stringify(
        { 
          type: 'fallback', 
          error: `[executeAgentStep] workers-ai ai/run api error (${responseCode}): ${responseText}`, 
          fallbackModel: CONFIG.AI_MODEL_FALLBACK_NAME
        }
      );
    throw new Error(`[executeAgentStep] AI Gateway error (${responseCode}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);

  if (parsed.error) {
    if (!isFallback) {
        return JSON.stringify(
          { 
            type: 'fallback', 
            error: JSON.stringify(parsed) || 'Unknown AI error', 
            fallbackModel: CONFIG.AI_MODEL_FALLBACK_NAME 
          }
        );
    }
    throw new Error(`[executeAgentStep] ${JSON.stringify(parsed) || 'Unknown AI error'}`);
  }

  let message;

  if (isFallback) {
      if (!parsed.success && parsed.errors && parsed.errors.length > 0) {
          throw new Error(`[executeAgentStep] ${parsed.errors[0].message || 'Unknown Workers AI error'}`);
      }
      let resultObj = parsed.result || parsed;
      message = {
          role: "assistant",
          content: resultObj.response || "",
          tool_calls: resultObj.tool_calls ? resultObj.tool_calls.map(function(tc) {
              return {
                  id: `call_${Utilities.getUuid()}`,
                  type: "function",
                  function: {
                      name: tc.name,
                      arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                  }
              };
          }) : []
      };
  } else {
      message = parsed.choices[0].message;
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    const proposeToolCall = message.tool_calls.find(function(t) { return t.function.name === 'propose_recipes'; });

    if (proposeToolCall) {
      try {
        const args = JSON.parse(proposeToolCall.function.arguments);
        let recipes = args.recipes || [];

        recipes = enrichRecipesWithImages(recipes);

        return JSON.stringify({
          type: "final",
          response: {
             message: "Here are some options I found for you.",
             proposals: recipes,
             doc_url: ""
          }
        });
      } catch (err) {
         messages.push({
             role: "assistant",
             tool_calls: message.tool_calls
         });
         messages.push({
           role: "tool",
           tool_call_id: proposeToolCall.id,
           name: proposeToolCall.function.name,
           content: "Error executing tool: " + err.message
         });
         return JSON.stringify({ type: "tool_calls", message: message, messages: messages, tools: message.tool_calls });
      }
    } else {
        messages.push(message);
        return JSON.stringify({ type: "tool_calls", message: message, messages: messages, tools: message.tool_calls });
    }
  }

  try {
    const finalData = JSON.parse(message.content);
    return JSON.stringify(
      { 
        type: "final", 
        response: finalData 
      }
    );
  } catch (error) {
    console.log(`[executeAgentStep] ${JSON.stringify(error)}`);
    return JSON.stringify(
      { 
        type: "final", 
        response: { 
          message: message.content || "", 
          proposals: [], 
          doc_url: "" 
        } 
      }
    );
  }
}
