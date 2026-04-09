/**
 * @fileoverview Refactored AI Gateway Execution
 * Targets: Google Apps Script (V8)
 * Implements: Thought Signature preservation for Gemini 3.
 */

/**
 * Executes a single turn in the AI conversation.
 * @param {Array} messages - Conversation history.
 * @param {boolean} isFallback - Explicitly passed from frontend google.script.run.
 */
function chatWithAI_step(messages, isFallback = false) {
  const fullMessages = messages || [];
  
  if (fullMessages.length === 0 || fullMessages[0].role !== 'system') {
    fullMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  }

  try {
    return executeAgentStep(fullMessages, isFallback);
  } catch (error) {
    console.error(`[chatWithAI_step] Error encountered: ${error.message}`);
    // If primary model fails (e.g. 400 signature error), signal frontend to use fallback turn.
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
 * FIXED: Preserves all model-generated expert insights.
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
    max_completion_tokens: 4096 // Ensure budget for complex structured output
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

  const parsed = JSON.parse(response.getContentText());
  const aiMessage = parsed.choices[0].message;

  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    const proposeCall = aiMessage.tool_calls.find(tc => tc.function.name === 'propose_recipes');
    
    if (proposeCall) {
      const args = JSON.parse(proposeCall.function.arguments);
      let recipes = args.recipes || [];
      const titles = recipes.map(r => r.title);
      
      // Perform bulk image search
      const images = findRecipeImagesBulk(titles);
      
      // MERGE INSTEAD OF OVERWRITE
      recipes = recipes.map((r, i) => ({
        ...r, // Preserves culinaryScience, chefInsights, instructions, etc.
        imageUrl: images[i] || r.imageUrl || "",
        // Ensure defaults only if the model completely missed them
        culinaryScience: r.culinaryScience || [],
        restaurantTechniques: r.restaurantTechniques || [],
        troubleshooting: r.troubleshooting || [],
        chefInsights: r.chefInsights || [],
        calories: r.calories || "N/A"
      }));

      return JSON.stringify({
        type: "final",
        response: {
          message: "I've curated three specialized options for you.",
          proposals: recipes,
          doc_url: ""
        }
      });
    }

    return JSON.stringify({ type: "tool_calls", message: aiMessage, tools: aiMessage.tool_calls });
  }

  return finalizeOutput(aiMessage.content);
}

/**
 * Standardizes final output.
 * Fix: Prevents "null" response objects which crash the frontend.
 */
function finalizeOutput(content) {
  // If content is null/undefined (typical in tool-only turns), provide empty defaults.
  if (content === null || content === undefined || content === "null") {
     return JSON.stringify({ 
       type: "final", 
       response: { message: "", proposals: [], doc_url: "" } 
     });
  }

  try {
    const data = JSON.parse(content);
    // Explicitly handle JSON.parse("null") returning null.
    if (!data) throw new Error(`[finalizeOutput] Parsed data is null; content: ${content}`);    
    const keys = Object.keys(data).toString().toLowerCase();
    
    if(keys.indexOf('proposals') === -1) data.proposals = [];
    
    return JSON.stringify({ type: "final", response: data });
  } catch (e) {
    return JSON.stringify({
      type: "final",
      response: { message: content, proposals: [], doc_url: "" }
    });
  }
}
