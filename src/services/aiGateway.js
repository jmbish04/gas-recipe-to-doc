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
function chatWithAI(messages) {
  // Prepend the static system prompt to the message history to anchor the agent's behavior.
  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
  ];

  // Extract the most recent user message from the array for auditing purposes.
  const lastUserMsg = [...messages].reverse().find(function(m) { return m.role === 'user'; });

  // If a valid user message exists, log it to the audit sheet asynchronously.
  if (lastUserMsg) {
    _logToSheet_('chat', 'User Input', lastUserMsg.content, '');
  }

  // Pass the enriched message array into the recursive execution engine.
  return executeAgentLoop(fullMessages);
}

/**
 * Recursively resolves tool calls from the AI model until a final structured output is reached.
 * @param {Array} messages - The cumulative message history including tool request/response pairs.
 * @param {number} depth - The current recursion depth to prevent infinite loops (Circuit Breaker).
 * @returns {string} The final JSON string payload.
 */
function executeAgentLoop(messages, depth = 0) {
  // Circuit breaker: Prevent infinite execution loops by capping recursion at 5 depths.
  if (depth > 5) {
    // Return a safe, schema-compliant fallback response if the depth limit is exceeded.
    return JSON.stringify({
      message: "I reached my maximum tool execution limit. Please try your request again.",
      options: [],
      doc_url: ""
    });
  }

  // Construct the payload utilizing OpenAI standard parameters compatible with CF AI Gateway.
  const payload = {
    model: CONFIG.AI_MODEL,
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

  // Validate the network response; throw explicit errors for gateway failures to trigger upstream catching.
  if (responseCode !== 200) {
    throw new Error('AI Gateway error (' + responseCode + '): ' + responseText);
  }

  // Parse the JSON body from the gateway.
  const parsed = JSON.parse(responseText);

  // Check for logical API errors returned within a 200 OK wrapper.
  if (parsed.error) {
    throw new Error(parsed.error.message || 'Unknown AI error');
  }

  // Isolate the primary message object from the model's choices array.
  const message = parsed.choices[0].message;

  // Evaluate if the model has requested to invoke any functions/tools.
  if (message.tool_calls && message.tool_calls.length > 0) {

    // 1. Append the model's tool request to the message history to maintain conversational continuity.
    messages.push({
      role: message.role,
      content: message.content || "",
      tool_calls: message.tool_calls
    });

    // 2. Iterate over each requested tool call and execute the corresponding localized function.
    message.tool_calls.forEach(function(toolCall) {
      let resultContent = "";
      try {
        // Parse the stringified JSON arguments provided by the model.
        const args = JSON.parse(toolCall.function.arguments);

        // Route the execution based on the specific function name.
        if (toolCall.function.name === 'search_web') {
          // Trigger the Google Custom Search utility.
          resultContent = searchGoogleCustom(args.query);
        } else if (toolCall.function.name === 'search_image') {
          // Trigger the Image Search utility and provide a safe fallback if no image is found.
          resultContent = findRecipeImage(args.title) || "No image found.";
        } else if (toolCall.function.name === 'create_recipe_doc') {
          // Trigger the Document Actuation utility. Parse the resulting JSON to extract the URL.
          const docRes = JSON.parse(createRecipeDoc(args));
          resultContent = "Document created successfully: " + docRes.url;
        } else {
          // Handle hallucinated or unsupported tool names.
          resultContent = "Unknown tool requested.";
        }
      } catch (err) {
        // Catch localized execution errors and feed them back to the AI so it can attempt a correction.
        resultContent = "Error executing tool: " + err.message;
      }

      // 3. Append the execution results back into the context window under the 'tool' role.
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: resultContent
      });
    });

    // 4. Recurse into the loop, providing the gateway with the updated context window containing tool results.
    return executeAgentLoop(messages, depth + 1);
  }

  // If no tools were called, the schema is satisfied. Return the raw stringified JSON content.
  return message.content;
}
