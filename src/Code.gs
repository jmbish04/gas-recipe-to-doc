/**
 * RECIPE ASSISTANT WEB APP
 * Self-contained GAS SPA with AI chat, recipe export, and history.
 * Standards: Senior Codex Engineer - High Performance & Self-Healing
 */

// --- CONFIGURATION ---
const CONFIG = {
  TEMPLATE_ID: '13LXhg3sBiPHcOhLM25wJuIREK1MzIReNu4BwrEXGdPU',
  FOLDER_ID: '1E0Mw2uZovNIJxFJ76chDzbrNyGef8jKJ',
  LOG_SHEET_ID: '15OZdqdenNGVASN_EjygVuQkpL6ldO_Lk-hDon7aszw4',
  SEARCH_API_KEY: 'YOUR_GOOGLE_CUSTOM_SEARCH_API_KEY',
  SEARCH_CX: 'YOUR_SEARCH_ENGINE_ID',
  CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/YOUR_ACCOUNT_ID/YOUR_GATEWAY_SLUG/openai/chat/completions',
  CF_AI_API_KEY: 'YOUR_OPENAI_API_KEY',
  AI_MODEL: 'gpt-4o-mini',
  HISTORY_SHEET_NAME: 'History'
};

const SYSTEM_PROMPT = `You are a helpful recipe assistant. When the user asks for a recipe, respond ONLY with a JSON object in this exact format:
{
  "type": "recipe",
  "message": "Here's a great recipe for you!",
  "recipe": {
    "title": "Recipe Name",
    "description": "Brief description",
    "prepTime": "X minutes",
    "cookTime": "X minutes",
    "servings": "X servings",
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["Do this", "Do that"]
  }
}
For all other questions, respond ONLY with a JSON object:
{"type": "text", "message": "Your response here"}
Always respond with valid JSON. Do not include markdown code blocks.`;

/**
 * Serves the React SPA for GET requests.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Recipe Assistant')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Handle POST requests from external agents (backward compatibility).
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (!data.title || !data.ingredients || !data.instructions) {
      throw new Error('Missing required recipe fields: title, ingredients, or instructions.');
    }

    const result = JSON.parse(createRecipeDoc(data));

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      documentId: result.docId,
      url: result.url,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Proxies chat messages to the Cloudflare AI Gateway and logs the query.
 * Called from the client via google.script.run.
 * @param {Array} messages - Array of {role, content} message objects.
 * @returns {string} JSON string with {type, message, recipe?}.
 */
function chatWithAI(messages) {
  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
  ];

  // Log the most recent user query before the API call (non-blocking)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    _logToSheet_('search', lastUserMsg.content, JSON.stringify(messages.slice(-5)), '');
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + CONFIG.CF_AI_API_KEY
    },
    payload: JSON.stringify({
      model: CONFIG.AI_MODEL,
      messages: fullMessages,
      temperature: 0.7
    }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(CONFIG.CF_AI_GATEWAY_URL, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error('AI Gateway error (' + responseCode + '): ' + responseText);
  }

  const parsed = JSON.parse(responseText);
  if (parsed.error) {
    throw new Error(parsed.error.message || 'Unknown AI error');
  }

  const content = parsed.choices[0].message.content;

  // Ensure we always return valid JSON to the client
  try {
    JSON.parse(content);
    return content;
  } catch (_) {
    return JSON.stringify({ type: 'text', message: content });
  }
}

/**
 * Creates a Google Doc from a recipe using the template.
 * Saves the doc to the configured Drive folder and logs the export.
 * Called from the client via google.script.run.
 * @param {Object} recipe - Recipe data object.
 * @returns {string} JSON string with {docId, url}.
 */
function createRecipeDoc(recipe) {
  const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  body.replaceText('{{TITLE}}', recipe.title.toUpperCase());
  body.replaceText('{{DESCRIPTION}}', recipe.description || 'A delicious home-cooked meal.');
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || 'N/A');
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || 'N/A');
  body.replaceText('{{SERVINGS}}', recipe.servings || '1-2');

  const ingredientsText = (recipe.ingredients || []).map(function(item) { return '\u2022 ' + item; }).join('\n');
  body.replaceText('{{INGREDIENTS}}', ingredientsText);

  const instructionsText = (recipe.instructions || []).map(function(step, i) { return (i + 1) + '. ' + step; }).join('\n\n');
  body.replaceText('{{INSTRUCTIONS}}', instructionsText);

  // Attempt to fetch and embed a recipe image
  const imageUrl = findRecipeImage(recipe.title);
  if (imageUrl) {
    try {
      const resp = UrlFetchApp.fetch(imageUrl);
      const blob = resp.getBlob();
      const placeholder = body.findText('{{IMAGE}}');
      if (placeholder) {
        const element = placeholder.getElement();
        const parent = element.getParent();
        const img = parent.asParagraph().insertInlineImage(0, blob);
        const width = 450;
        const height = (img.getHeight() / img.getWidth()) * width;
        img.setWidth(width).setHeight(height);
        element.asText().setText('');
      }
    } catch (imgErr) {
      console.warn('Failed to insert image: ' + imgErr.message);
      body.replaceText('{{IMAGE}}', '[Image unavailable]');
    }
  } else {
    body.replaceText('{{IMAGE}}', '');
  }

  doc.saveAndClose();

  const docUrl = 'https://docs.google.com/document/d/' + newFile.getId() + '/edit';
  logExport(recipe, docUrl);

  return JSON.stringify({ docId: newFile.getId(), url: docUrl });
}

/**
 * Logs an exported recipe to the History spreadsheet.
 * Called from the client via google.script.run (and internally by createRecipeDoc).
 * @param {Object} recipeData - Recipe data object.
 * @param {string} docUrl - URL of the created Google Doc.
 */
function logExport(recipeData, docUrl) {
  const details = JSON.stringify({
    description: recipeData.description,
    cookTime: recipeData.cookTime,
    prepTime: recipeData.prepTime,
    servings: recipeData.servings,
    ingredientCount: (recipeData.ingredients || []).length
  });
  _logToSheet_('export', recipeData.title, details, docUrl);
}

/**
 * Fetches search and export history from the History spreadsheet.
 * Called from the client via google.script.run.
 * @returns {string} JSON array of history items (most recent first).
 */
function getHistory() {
  const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.HISTORY_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return JSON.stringify([]);
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  const rows = data
    .filter(function(row) { return !!row[0]; })
    .map(function(row) {
      return {
        timestamp: row[0] ? new Date(row[0]).toISOString() : '',
        type: row[1] || '',
        name: row[2] || '',
        details: row[3] || '',
        url: row[4] || ''
      };
    })
    .reverse();

  return JSON.stringify(rows);
}

/**
 * Searches Google Custom Search API for a high-resolution recipe image.
 * @param {string} title - Recipe title.
 * @returns {string|null} Image URL or null on failure.
 */
function findRecipeImage(title) {
  const query = encodeURIComponent(title + ' food photography high resolution');
  const url = 'https://www.googleapis.com/customsearch/v1?key=' + CONFIG.SEARCH_API_KEY +
    '&cx=' + CONFIG.SEARCH_CX + '&searchType=image&q=' + query + '&num=1';
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const result = JSON.parse(response.getContentText());
    return result.items && result.items.length > 0 ? result.items[0].link : null;
  } catch (e) {
    console.warn('Image search failed: ' + e.message);
    return null;
  }
}

/**
 * Internal helper: appends a row to the History sheet, creating it if needed.
 * Failures are swallowed so they never interrupt user-facing operations.
 */
function _logToSheet_(type, name, details, url) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    let sheet = ss.getSheetByName(CONFIG.HISTORY_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.HISTORY_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Type', 'Name', 'Details', 'URL']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), type, name, details, url]);
  } catch (logErr) {
    console.error('Failed to log to sheet: ' + logErr.message);
  }
}

