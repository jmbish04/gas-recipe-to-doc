/**
 * @fileoverview Google Docs Actuation Service
 * @module services/googleDocs
 * @description Handles the instantiation, templating, and formatting of Google Documents.
 * Maps structured AI payloads directly into a finalized, stylized artifact.
 */

/**
 * Creates a Google Doc from a recipe using the pre-configured template.
 * @param {Object} recipe - Structured recipe data object mapped from the AI tool payload.
 * @returns {string} JSON stringified object containing the newly created {docId, url}.
 */
function createRecipeDoc(recipe) {
  // Retrieve the master template file via the Drive API.
  const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);

  // Retrieve the target destination folder.
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);

  // Clone the template into the target folder, assigning a dynamic title.
  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);

  // Open the newly cloned document to begin text manipulation.
  const doc = DocumentApp.openById(newFile.getId());

  // Extract the mutable body element from the document.
  const body = doc.getBody();

  // Execute string replacements across the document body for standard metadata fields.
  // Use toUpperCase() for the title to enforce strict styling constraints.
  body.replaceText('{{TITLE}}', (recipe.title || '').toUpperCase());
  body.replaceText('{{DESCRIPTION}}', recipe.description || 'A delicious home-cooked meal.');
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || 'N/A');
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || 'N/A');
  body.replaceText('{{SERVINGS}}', recipe.servings || '1-2');

  // Format the ingredients array into a bulleted string list.
  const ingredientsText = (recipe.ingredients || []).map(function(item) { return '\u2022 ' + item; }).join('\n');
  body.replaceText('{{INGREDIENTS}}', ingredientsText);

  // Format the instructions array into a numbered string list with double spacing for readability.
  const instructionsText = (recipe.instructions || []).map(function(step, i) { return (i + 1) + '. ' + step; }).join('\n\n');
  body.replaceText('{{INSTRUCTIONS}}', instructionsText);

  // Extract the image URL provided by the AI's parameter payload.
  const imageUrl = recipe.imageUrl;

  // Conditionally process image insertion if a valid URL was supplied.
  if (imageUrl && imageUrl.trim() !== '') {
    try {
      // Fetch the raw image blob data from the external URL.
      const resp = UrlFetchApp.fetch(imageUrl);
      const blob = resp.getBlob();

      // Locate the image placeholder string within the document.
      const placeholder = body.findText('{{IMAGE}}');

      // If the placeholder exists, replace it with the actual inline image.
      if (placeholder) {
        // Traverse the DOM to find the paragraph element housing the placeholder text.
        const element = placeholder.getElement();
        const parent = element.getParent();

        // Insert the image blob at the beginning of the paragraph.
        const img = parent.asParagraph().insertInlineImage(0, blob);

        // Calculate and enforce a standardized width of 450px while maintaining the original aspect ratio.
        const width = 450;

        // Guard against invalid width dimensions from Blob to avoid divide by zero errors and 0 height crashes.
        let height = 450; // Fallback default 1:1 aspect ratio height
        const originalWidth = img.getWidth();
        const originalHeight = img.getHeight();

        if (originalWidth > 0 && originalHeight > 0) {
           height = Math.round((originalHeight / originalWidth) * width);
           // extra guard to ensure calculated height does not end up as 0 due to rounding
           if (height <= 0) height = width;
        }

        img.setWidth(width).setHeight(height);

        // Strip out the original placeholder text string.
        element.asText().setText('');
      }
    } catch (imgErr) {
      // Log external image fetching failures gracefully without crashing the document generation.
      console.warn('Failed to insert image: ' + imgErr.message);
      // Replace the placeholder with a fallback string so the UI doesn't look broken.
      body.replaceText('{{IMAGE}}', '[Image unavailable]');
    }
  } else {
    // If no URL was provided, strip the placeholder entirely to maintain clean formatting.
    body.replaceText('{{IMAGE}}', '');
  }

  // Force a save and close operation to ensure all text replacements are flushed to Drive.
  doc.saveAndClose();

  // Construct the final public edit URL for the newly minted document.
  const docUrl = 'https://docs.google.com/document/d/' + newFile.getId() + '/edit';

  // Trigger an asynchronous logging event to record the successful actuation.
  logExport(recipe, docUrl);

  // Return the standardized JSON payload required by the upstream execution loop and frontend.
  return JSON.stringify({ docId: newFile.getId(), url: docUrl });
}
