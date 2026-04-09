/**
 * @fileoverview Google Docs Actuation Service (Cloudflare Enhanced)
 * @module services/googleDocs
 * @description Handles the instantiation, templating, and formatting of Google Documents.
 * Integrates Cloudflare Images for media persistence and optimization.
 */

/**
 * Creates a Google Doc from a recipe using the pre-configured template.
 * @param {Object} recipe - Structured recipe data object mapped from the AI tool payload.
 * @returns {string} JSON stringified object containing the newly created {docId, url}.
 */
function createRecipeDoc(recipe) {
  // 1. Fetch Configuration and Secrets
  const props = PropertiesService.getScriptProperties();
  const CF_TOKEN = props.getProperty('CLOUDFLARE_IMAGES_STREAM_TOKEN');
  const CF_ACCOUNT_ID = props.getProperty('CLOUDFLARE_ACCOUNT_ID');

  const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);
  const folder = DriveApp.getFolderById('1E0Mw2uZovNIJxFJ76chDzbrNyGef8jKJ');

  // 2. Document Initialization
  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // 3. Text Replacements
  body.replaceText('{{TITLE}}', (recipe.title || '').toUpperCase());
  body.replaceText('{{DESCRIPTION}}', recipe.description || 'A delicious home-cooked meal.');
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || 'N/A');
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || 'N/A');
  body.replaceText('{{SERVINGS}}', recipe.servings || '1-2');
  body.replaceText('{{CALORIES}}', recipe.calories || 'unknown calories');
  body.replaceText('{{TIPS}}', recipe.calories || 'No specific tips, just have fun!');

  const ingredientsText = (recipe.ingredients || []).map(function(item) { return '\u2022 ' + item; }).join('\n');
  body.replaceText('{{INGREDIENTS}}', ingredientsText);

  const instructionsText = (recipe.instructions || []).map(function(step, i) { return (i + 1) + '. ' + step; }).join('\n\n');
  body.replaceText('{{INSTRUCTIONS}}', instructionsText);

  // 4. Persistent Image Actuation via Cloudflare
  let finalImageUrl = recipe.imageUrl;

  if (finalImageUrl && finalImageUrl.trim() !== '') {
    try {
      // Step A: Ingest into Cloudflare Images for persistence (AI URLs expire)
      const cfApiUrl = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/images/v1';
      const uploadResponse = UrlFetchApp.fetch(cfApiUrl, {
        method: 'post',
        headers: { 'Authorization': 'Bearer ' + CF_TOKEN },
        payload: {
          url: finalImageUrl,
          metadata: JSON.stringify({ recipeTitle: recipe.title, source: 'AI_AGENT' })
        }
      });

      const uploadResult = JSON.parse(uploadResponse.getContentText());

      if (uploadResult.success) {
        // Use the 'public' variant or the first available variant
        finalImageUrl = uploadResult.result.variants[0];
      }

      // Step B: Fetch the blob from the persistent Cloudflare URL
      const resp = UrlFetchApp.fetch(finalImageUrl);
      const blob = resp.getBlob();

      const placeholder = body.findText('{{IMAGE}}');
      if (placeholder) {
        const element = placeholder.getElement();
        const parent = element.getParent();
        const img = parent.asParagraph().insertInlineImage(0, blob);

        // Standardized width of 450px with safe aspect ratio calculation
        const width = 450;
        const originalWidth = img.getWidth() || 1; // Prevent division by zero
        const height = Math.round((img.getHeight() / originalWidth) * width);

        img.setWidth(width).setHeight(Math.max(height, 1));
        element.asText().setText('');
      }
    } catch (imgErr) {
      console.warn('Cloudflare Image Ingestion Failed: ' + imgErr.message);
      body.replaceText('{{IMAGE}}', '[Image persistence failed: ' + imgErr.message + ']');
    }
  } else {
    body.replaceText('{{IMAGE}}', '');
  }

  // 5. Finalize Document
  doc.saveAndClose();
  const docUrl = 'https://docs.google.com/document/d/' + newFile.getId() + '/edit';

  // Trigger logging (ensure logExport is defined in your environment)
  if (typeof logExport === 'function') {
    logExport(recipe, docUrl);
  }

  return JSON.stringify({ docId: newFile.getId(), url: docUrl });
}
