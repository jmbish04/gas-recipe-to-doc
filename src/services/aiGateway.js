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
  // Construct the payload utilizing OpenAI standard parameters compatible with CF AI Gateway.
  const payload = {
    model: isFallback ? CONFIG.AI_MODEL_FALLBACK_NAME : CONFIG.AI_MODEL,
    messages: messages,
    tools: TOOLS,
    // Allow the model to autonomously decide whether to call a tool or finalize the response.
    tool_choice: "auto",
    // Enforce the strict JSON response format defined in the agent configuration.
    response_format: RESPONSE_FORMAT,
    // Set a moderate temperature for a balance between creativity and deterministic tool usage.
    temperature: 0.5
  };

  // Configure the HTTP request parameters for the UrlFetchApp.
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      // Authenticate via the Cloudflare-specific AI Gateway authorization header.
      'cf-aig-authorization': 'Bearer ' + CONFIG.CLOUDFLARE_AI_GATEWAY_KEY
    },
    payload: JSON.stringify(payload),
    // Prevent GAS from throwing immediate exceptions on non-200 responses so we can parse the error.
    muteHttpExceptions: true
  };

  // Execute the synchronous blocking network request to the AI Gateway.
  const response = UrlFetchApp.fetch(CONFIG.CLOUDFLARE_AI_GATEWAY_URL, options);

  // Extract HTTP status and raw body content for validation.
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  // Validate the network response; handle gateway failures.
  if (responseCode !== 200) {
    if (!isFallback) {
      return JSON.stringify({ type: 'fallback', error: 'AI Gateway error (' + responseCode + '): ' + responseText, fallbackModel: CONFIG.AI_MODEL_FALLBACK_NAME });
    }
    throw new Error('AI Gateway error (' + responseCode + '): ' + responseText);
  }

  // Parse the JSON body from the gateway.
  const parsed = JSON.parse(responseText);

  // Check for logical API errors returned within a 200 OK wrapper.
  if (parsed.error) {
    if (!isFallback) {
        return JSON.stringify({ type: 'fallback', error: parsed.error.message || 'Unknown AI error', fallbackModel: CONFIG.AI_MODEL_FALLBACK_NAME });
    }
    throw new Error(parsed.error.message || 'Unknown AI error');
  }

  // Isolate the primary message object from the model's choices array.
  const message = parsed.choices[0].message;

  // Evaluate if the model has requested to invoke any functions/tools.
  if (message.tool_calls && message.tool_calls.length > 0) {

    // Explicitly handle propose_recipes to short-circuit the execution and return final result
    const proposeToolCall = message.tool_calls.find(function(t) { return t.function.name === 'propose_recipes'; });

    if (proposeToolCall) {
      try {
        const args = JSON.parse(proposeToolCall.function.arguments);
        let recipes = args.recipes || [];

        // Enrich the recipes with images using the new pipeline logic
        recipes = enrichRecipesWithImages(recipes);

        // Return structured proposals directly to frontend
        return JSON.stringify({
          type: "final",
          response: {
             message: "Here are some options I found for you.",
             proposals: recipes,
             doc_url: ""
          }
        });
      } catch (err) {
         // Fallback if parsing fails
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

  // Ensure we always return valid JSON to the client
  try {
    const finalData = JSON.parse(message.content);
    return JSON.stringify({ type: "final", response: finalData });
  } catch (_) {
    return JSON.stringify({ type: "final", response: { message: message.content || "", proposals: [], doc_url: "" } });
  }
}
