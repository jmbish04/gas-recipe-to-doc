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
 * Standardized inference turn. Removed recursion to prevent model forcing.
 */
function executeAgentStep(messages, isFallback = false) {
  const model = isFallback ? CONFIG.AI_MODEL_FALLBACK_NAME : CONFIG.AI_MODEL;
  
  // Map history while preserving Gemini-specific thought signatures if present.
  const sanitizedMessages = messages.map(msg => {
    const cleanMsg = {
      role: msg.role,
      content: Array.isArray(msg.content) 
        ? msg.content.map(c => c.text || '').join('') 
        : (msg.content || "")
    };
    if (msg.tool_calls) cleanMsg.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) cleanMsg.tool_call_id = msg.tool_call_id;
    if (msg.name) cleanMsg.name = msg.name;
    
    // Support Gemini 3: Re-echo signatures from previous turns if available.
    if (msg.thought_signature) cleanMsg.thought_signature = msg.thought_signature;
    
    return cleanMsg;
  });

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

  const response = UrlFetchApp.fetch(CONFIG.CLOUDFLARE_AI_GATEWAY_URL, {
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

  // Capture Gemini 3 Thought Signature from current response if provided by Gateway.
  if (parsed.choices[0].thought_signature) {
    aiMessage.thought_signature = parsed.choices[0].thought_signature;
  }

  // Phase 1: Intercept Propose Recipes to prevent generative stall.
  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    const proposeCall = aiMessage.tool_calls.find(tc => tc.function.name === 'propose_recipes');
    
    if (proposeCall) {
      const args = JSON.parse(proposeCall.function.arguments);
      let recipes = args.recipes || [];
      const titles = recipes.map(r => r.title);
      const images = findRecipeImagesBulk(titles);
      
      recipes = recipes.map((r, i) => ({
        ...r,
        imageUrl: images[i] || "",
        culinaryScience: ["Optimization of Maillard reaction", "Thermal stability management"],
        restaurantTechniques: ["Multi-dimensional plating", "Texture contrast layering"],
        troubleshooting: ["Visual doneness sensory cues"],
        chefInsights: ["Acid-balance adjustment"],
        calories: r.calories || "300-500 kcal"
      }));

      return JSON.stringify({
        type: "final",
        response: {
          message: "I have prepared three specialized recipe options for you.",
          proposals: recipes,
          doc_url: ""
        }
      });
    }

    // Return to frontend to execute search_web or other tools.
    return JSON.stringify({ 
      type: "tool_calls", 
      message: aiMessage, 
      tools: aiMessage.tool_calls 
    });
  }

  return finalizeOutput(aiMessage.content);
}

function finalizeOutput(content) {
  try {
    const data = JSON.parse(content);
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
