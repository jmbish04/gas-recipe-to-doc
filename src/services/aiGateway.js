/**
 * @fileoverview Refactored AI Gateway Execution
 * Targets: Google Apps Script (V8)
 * Implements: Image Pipeline Restoration and Reasoning Budget (4096 tokens).
 */

/**
 * Executes a single turn in the AI conversation.
 * @param {Array} messages - Conversation history.
 * @param {boolean} isFallback - Explicitly passed from frontend.
 */
function chatWithAI_step(messages, isFallback = false, clientSessionId) {
  if (clientSessionId) CONFIG.SESSION_ID = clientSessionId;
  const startTime = Date.now();
  console.log(`[chatWithAI_step] START`);
  logTelemetry(chatWithAI_step, 'Function started', { isFallback: isFallback, messageCount: (messages || []).length });

  const fullMessages = messages || [];
  if (fullMessages.length === 0 || fullMessages[0].role !== 'system') {
    console.log(`[chatWithAI_step] STEP: Injecting system prompt (+${Date.now() - startTime}ms)`);
    fullMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  }

  try {
    const result = executeAgentStep(fullMessages, isFallback);
    console.log(`[chatWithAI_step] SUCCESS: Function completed (+${Date.now() - startTime}ms)`);
    logTelemetry(chatWithAI_step, 'Function completed successfully', { elapsedMs: Date.now() - startTime });
    return result;
  } catch (error) {
    console.error(`[chatWithAI_step] Error: ${error.message}`);
    logTelemetry(chatWithAI_step, 'Error executing AI step', error);

    if (!isFallback) {
      return JSON.stringify({ 
        type: 'fallback', 
        error: error.message, 
        primaryModel: CONFIG.AI_MODEL,
        fallbackModel: CONFIG.AI_MODEL_FALLBACK_NAME
      });
    }
    throw error;
  }
}

/**
 * Standardized inference turn.
 * RESTORED: Now triggers enrichRecipesWithImages for full scraping/CF upload sequence.
 */
function executeAgentStep(messages, isFallback = false) {
  const startTime = Date.now();
  console.log(`[executeAgentStep] START`);
  logTelemetry(executeAgentStep, 'Function started', { isFallback: isFallback });
  const workersAiModelName = _sanitizeWorkersAiModelName_(CONFIG.AI_MODEL_FALLBACK_NAME);

  const model = isFallback ? workersAiModelName: CONFIG.AI_MODEL;
  
  console.log(`[executeAgentStep] STEP: Sanitizing messages for model ${model} (+${Date.now() - startTime}ms)`);
  const sanitizedMessages = messages.map(msg => ({
    role: msg.role,
    content: Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : (msg.content || ""),
    ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
    ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
    ...(msg.name && { name: msg.name }),
    ...(msg.thought_signature && { thought_signature: msg.thought_signature })
  }));

  const payload = {
    model: model,
    messages: sanitizedMessages,
    tools: TOOLS,
    tool_choice: "auto",
    response_format: RESPONSE_FORMAT,
    temperature: 0.5,
    /**
     * Reasoning Budget: Essential for models like gpt-oss-120b to
     * process deep culinary logic without early truncation.
     */
    max_completion_tokens: 4096
  };

  const endpointUrl = CONFIG.CLOUDFLARE_AI_GATEWAY_COMPAT_URL;
  // Note: _redactUrl helper assumed to be in global scope from utility upgrades
  console.log(`[executeAgentStep] STEP: Calling API: ${typeof _redactUrl === 'function' ? _redactUrl(endpointUrl) : endpointUrl} (+${Date.now() - startTime}ms)`);
  
  const response = UrlFetchApp.fetch(endpointUrl, {
    method: 'post',
    headers: { 
      "cf-aig-authorization": `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`,
      "Content-Type": "application/json" 
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  console.log(`[executeAgentStep] STEP: API call returned code ${code} (+${Date.now() - startTime}ms)`);
  console.log(`[executeAgentStep] Received from API: ${text.substring(0, 500)}...`);

  if (code !== 200) {
    const apiError = new Error(`AI_GATEWAY_ERROR_${code}: ${text}`);
    logTelemetry(executeAgentStep, 'Cloudflare AI Gateway returned non-200 code', apiError);
    throw apiError;
  }

  const parsed = JSON.parse(text);
  const aiMessage = parsed.choices[0].message;

  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    const proposeCall = aiMessage.tool_calls.find(tc => tc.function.name === 'propose_recipes');
    
    if (proposeCall) {
      console.log(`[executeAgentStep] STEP: Propose recipes tool detected, starting image pipeline (+${Date.now() - startTime}ms)`);
      const args = JSON.parse(proposeCall.function.arguments);
      let recipes = args.recipes || [];
      
      /**
       * PIPELINE ACTIVATION:
       * enrichRecipesWithImages orchestrates scrapeImagesFromUrl,
       * getRecipeImageUrl, and uploadToCloudflareImages.
       */
      const pipelineStart = Date.now();
      recipes = enrichRecipesWithImages(recipes);
      console.log(`[executeAgentStep] STEP: Image pipeline completed in ${Date.now() - pipelineStart}ms (+${Date.now() - startTime}ms total)`);

      const finalResponse = JSON.stringify({
        type: "final",
        response: {
          message: "I have prepared three specialized culinary options with optimized plating visuals.",
          proposals: recipes,
          doc_url: ""
        }
      });
      
      console.log(`[executeAgentStep] SUCCESS: Proposals finalized (+${Date.now() - startTime}ms)`);
      logTelemetry(executeAgentStep, 'Propose recipes tool flow completed', { recipeCount: recipes.length, elapsedMs: Date.now() - startTime });
      return finalResponse;
    }

    console.log(`[executeAgentStep] SUCCESS: Tool calls detected (+${Date.now() - startTime}ms)`);
    logTelemetry(executeAgentStep, 'Function returning tool calls', { toolCallsCount: aiMessage.tool_calls.length });
    return JSON.stringify({ type: "tool_calls", message: aiMessage, tools: aiMessage.tool_calls });
  }

  const output = finalizeOutput(aiMessage.content);
  console.log(`[executeAgentStep] SUCCESS: Finalizing text output (+${Date.now() - startTime}ms)`);
  logTelemetry(executeAgentStep, 'Function completed successfully with text output', { elapsedMs: Date.now() - startTime });
  return output;
}

function finalizeOutput(content) {
  const startTime = Date.now();
  console.log(`[finalizeOutput] START`);
  logTelemetry(finalizeOutput, 'Function started', { contentSnippet: typeof content === 'string' ? content.substring(0, 50) : 'null' });

  if (!content || content === "null") {
    console.log(`[finalizeOutput] SUCCESS: Content empty or null (+${Date.now() - startTime}ms)`);
    return JSON.stringify({ type: "final", response: { message: "Ready.", proposals: [], doc_url: "" } });
  }
  try {
    const data = JSON.parse(content);
    if (!data) throw new Error("Parsed data is null.");
    // Ensure proposals key exists for frontend sanity
    if (!data.proposals) data.proposals = [];
    
    console.log(`[finalizeOutput] SUCCESS: Parsed JSON content (+${Date.now() - startTime}ms)`);
    logTelemetry(finalizeOutput, 'Function completed successfully', { elapsedMs: Date.now() - startTime });
    return JSON.stringify({ type: "final", response: data });
  } catch (e) {
    // Log the failure to the developer console but do not throw, allowing the system to degrade gracefully.
    console.warn(`[finalizeOutput] JSON parsing failed, returning raw string: ${JSON.stringify(e)}`);

    logTelemetry(finalizeOutput, 'JSON parsing failed', e)
    return JSON.stringify({ type: "final", response: { message: content, proposals: [], doc_url: "" } });
  }
}


/**
 * Generates an image using Cloudflare Workers AI FLUX model via AI Gateway.
 * This is a discrete function independent of the main AI Gateway class logic.
 * @param {string} prompt - The optimized recipe prompt for image generation.
 * @returns {GoogleAppsScript.Base.Blob} The generated image as a Blob.
 */
function generateRecipeImageFlux2(prompt) {
  const startTime = Date.now();
  const fnName = 'generateRecipeImageFlux2';
  console.log(`[${fnName}] START`);
  logTelemetry(generateRecipeImageFlux2, 'Function started', { promptLength: prompt ? prompt.length : 0 });

  if (!prompt) {
    const errorMsg = `[${fnName}] Missing required parameter: prompt`;
    console.error(errorMsg);
    logTelemetry(generateRecipeImageFlux2, 'Missing prompt', { error: errorMsg });
    throw new Error(errorMsg);
  }

  // 1. Resolve Model and Endpoint for AI Gateway
  // Format: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_slug}/workers-ai/{model_name}
  const modelNameRaw = CONFIG.AI_MODEL_IMAGE_CREATOR || "@cf/black-forest-labs/flux-2-dev";
  const workersAiModelName = modelNameRaw.replace('workers-ai/', '');
  
  // Derive the base Gateway URL by stripping the chat completion suffix
  const endpoint = `${CONFIG.CLOUDFLARE_WORKERS_AI_URL}/${workersAiModelName}`;
  const redactedEndpoint = typeof _redactUrl === 'function' ? _redactUrl(endpoint) : endpoint;

  console.log(`[${fnName}] STEP: Configuration resolved (+${Date.now() - startTime}ms)`);
  console.log(`[${fnName}] Calling API: ${redactedEndpoint} (+${Date.now() - startTime}ms)`);
  logTelemetry(generateRecipeImageFlux2, 'Calling API', { url: redactedEndpoint });

  // 2. Prepare Payload (Multipart/Form-Data logic per successful validation)
  // UrlFetchApp automatically handles objects as multipart/form-data when passed to payload.
  const payload = {
    'prompt': prompt,
    'steps': 25,
    'width': 1024,
    'height': 1024
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": `Bearer ${CONFIG.CLOUDFLARE_AI_GATEWAY_TOKEN}`
    },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const statusCode = response.getResponseCode();
    const resText = response.getContentText();

    console.log(`[${fnName}] STEP: API response received with code ${statusCode} (+${Date.now() - startTime}ms)`);

    if (statusCode !== 200) {
      const errorMsg = `[${fnName}] Cloudflare AI Error (${statusCode}): ${resText}`;
      console.error(errorMsg);
      logTelemetry(generateRecipeImageFlux2, 'API Error', { statusCode, response: resText });
      throw new Error(errorMsg);
    }

    const data = JSON.parse(resText);
    
    // Workers AI image models return a base64 string in data.result.image when called via this endpoint
    if (!data.success || !data.result || !data.result.image) {
      const errorMsg = `[${fnName}] Invalid response structure or generation failed.`;
      console.error(errorMsg, data);
      logTelemetry(generateRecipeImageFlux2, 'Invalid JSON structure', data);
      throw new Error(errorMsg);
    }

    console.log(`[${fnName}] STEP: Image data received, decoding base64 (+${Date.now() - startTime}ms)`);

    // 3. Process Result into Blob
    const bytes = Utilities.base64Decode(data.result.image);
    const imageBlob = Utilities.newBlob(bytes, 'image/jpeg', `recipe_flux_${Date.now()}.jpg`);

    const elapsed = Date.now() - startTime;
    console.log(`[${fnName}] SUCCESS: Image generated successfully in ${elapsed}ms`);
    logTelemetry(generateRecipeImageFlux2, 'Function completed successfully', { 
      elapsedMs: elapsed,
      blobSize: imageBlob.getBytes().length 
    });
    
    return imageBlob;

  } catch (error) {
    console.error(`[${fnName}] Error:`, error);
    logTelemetry(generateRecipeImageFlux2, 'Error generating image', error);
    throw error;
  }
}
