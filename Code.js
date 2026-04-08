```javascript
/**
 * RECIPE EXPORTER WEB APP
 * Endpoint: doPost(e)
 * Standards: Senior Codex Engineer - High Performance & Self-Healing
 */

// --- CONFIGURATION ---
const CONFIG = {
  TEMPLATE_ID: '13LXhg3sBiPHcOhLM25wJuIREK1MzIReNu4BwrEXGdPU',
  SEARCH_API_KEY: 'YOUR_GOOGLE_CUSTOM_SEARCH_API_KEY', // Replace with your key
  SEARCH_CX: 'YOUR_SEARCH_ENGINE_ID', // Replace with your CX
  FOLDER_NAME: 'Louis Recipe Collection'
};

/**
 * Handle POST requests from Cloudflare Worker or external agents
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // 1. Validation
    if (!data.title || !data.ingredients || !data.instructions) {
      throw new Error("Missing required recipe fields: title, ingredients, or instructions.");
    }

    // 2. Find Image
    const imageUrl = findRecipeImage(data.title);

    // 3. Create Doc from Template
    const docId = createRecipeDoc(data, imageUrl);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      documentId: docId,
      url: `https://docs.google.com/document/d/${docId}/edit`,
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
 * Searches Google for a recipe image
 */
function findRecipeImage(title) {
  const query = encodeURIComponent(`${title} food photography high resolution`);
  const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.SEARCH_API_KEY}&cx=${CONFIG.SEARCH_CX}&searchType=image&q=${query}&num=1`;
  
  try {
    const response = UrlFetchApp.fetch(url);
    const result = JSON.parse(response.getContentText());
    return result.items && result.items.length > 0 ? result.items[0].link : null;
  } catch (e) {
    console.warn("Image search failed: " + e.message);
    return null;
  }
}

/**
 * Duplicates template and populates data
 */
function createRecipeDoc(recipe, imageUrl) {
  const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);
  
  // Ensure destination folder exists
  let folder;
  const folders = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(CONFIG.FOLDER_NAME);
  }

  // Duplicate template
  const newFile = templateFile.makeCopy(`Recipe: ${recipe.title}`, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // Replace Text Placeholders
  body.replaceText('{{TITLE}}', recipe.title.toUpperCase());
  body.replaceText('{{DESCRIPTION}}', recipe.description || "A delicious home-cooked meal.");
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || "N/A");
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || "N/A");
  body.replaceText('{{SERVINGS}}', recipe.servings || "1-2");

  // Format Ingredients
  const ingredientsText = recipe.ingredients.map(item => `• ${item}`).join('\n');
  body.replaceText('{{INGREDIENTS}}', ingredientsText);

  // Format Instructions
  const instructionsText = recipe.instructions.map((step, i) => `${i + 1}. ${step}`).join('\n\n');
  body.replaceText('{{INSTRUCTIONS}}', instructionsText);

  // Handle Image Replacement
  if (imageUrl) {
    try {
      const resp = UrlFetchApp.fetch(imageUrl);
      const blob = resp.getBlob();
      
      // Look for the image placeholder or insert at top
      const placeholder = body.findText('{{IMAGE}}');
      if (placeholder) {
        const element = placeholder.getElement();
        const parent = element.getParent();
        const img = parent.asParagraph().insertInlineImage(0, blob);
        
        // Pretty sizing (approx 5 inches wide at 72dpi)
        const width = 450;
        const height = (img.getHeight() / img.getWidth()) * width;
        img.setWidth(width).setHeight(height);
        
        element.asText().setText(""); // Clear placeholder text
      }
    } catch (e) {
      console.warn("Failed to insert image: " + e.message);
      body.replaceText('{{IMAGE}}', "[Image search failed - Manual upload required]");
    }
  } else {
    body.replaceText('{{IMAGE}}', "");
  }

  doc.saveAndClose();
  return newFile.getId();
}

/**
 * Health Check & Docs endpoint for GET requests
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "healthy",
    service: "Recipe Exporter AppsScript",
    template: CONFIG.TEMPLATE_ID
  })).setMimeType(ContentService.MimeType.JSON);
}

```
