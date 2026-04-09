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
function chatWithAI_step(messages, isFallback = false) {
  const fullMessages = messages || [];
  if (fullMessages.length === 0 || fullMessages[0].role !== 'system') {
    fullMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  }

  try {
    return executeAgentStep(fullMessages, isFallback);
  } catch (error) {
    console.error(`[chatWithAI_step] Error: ${error.message}`);
    if (!isFallback) {
      return JSON.stringify({ 
        type: 'fallback', 
        error: error.message, 
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
  const model = isFallback ? CONFIG.AI_MODEL_FALLBACK_NAME : CONFIG.AI_MODEL;
  
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

  const response = UrlFetchApp.fetch(CONFIG.CLOUDFLARE_AI_GATEWAY_URL, {
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

  if (code !== 200) {
    throw new Error(`AI_GATEWAY_ERROR_${code}: ${text}`);
  }

  const parsed = JSON.parse(text);
  const aiMessage = parsed.choices[0].message;

  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    const proposeCall = aiMessage.tool_calls.find(tc => tc.function.name === 'propose_recipes');
    
    if (proposeCall) {
      const args = JSON.parse(proposeCall.function.arguments);
      let recipes = args.recipes || [];
      
      /**
       * PIPELINE ACTIVATION:
       * enrichRecipesWithImages orchestrates scrapeImagesFromUrl,
       * getRecipeImageUrl, and uploadToCloudflareImages.
       */
      recipes = enrichRecipesWithImages(recipes);

      return JSON.stringify({
        type: "final",
        response: {
          message: "I have prepared three specialized culinary options with optimized plating visuals.",
          proposals: recipes,
          doc_url: ""
        }
      });
    }

    return JSON.stringify({ type: "tool_calls", message: aiMessage, tools: aiMessage.tool_calls });
  }

  return finalizeOutput(aiMessage.content);
}

function finalizeOutput(content) {
  if (!content || content === "null") {
    return JSON.stringify({ type: "final", response: { message: "Ready.", proposals: [], doc_url: "" } });
  }
  try {
    const data = JSON.parse(content);
    if (!data) throw new Error("Parsed data is null.");
    // Ensure proposals key exists for frontend sanity
    if (!data.proposals) data.proposals = [];
    return JSON.stringify({ type: "final", response: data });
  } catch (e) {
    return JSON.stringify({ type: "final", response: { message: content, proposals: [], doc_url: "" } });
  }
}
