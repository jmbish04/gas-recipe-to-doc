/**
 * @fileoverview Google Docs Actuation Service (Cloudflare Enhanced)
 * @module services/googleDocs
 * @description Handles the instantiation, templating, and formatting of Google Documents.
 */

const MAX_TITLE_FONT_SIZE = 36; // Starting font size for the title
const MIN_TITLE_FONT_SIZE = 12;  // Minimum allowed font size before stopping

/**
 * Creates a Google Doc from a recipe using the pre-configured template.
 * @param {Object} recipe - Structured recipe data object.
 * @returns {string} JSON stringified object containing {docId, url}.
 */
function createRecipeDoc(recipe) {
  const CF_TOKEN = CONFIG.CF_IMAGES_API_TOKEN;
  const CF_ACCOUNT_ID = CONFIG.CLOUDFLARE_ACCOUNT_ID;

  let templateFile, folder;

  /* Try to obtain the template file and export folder */
  try{
    templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);
  }
  catch(error){
    console.log(`[createRecipeDoc] Unable to access the Template Recipe Doc. ID provided was ${CONFIG.TEMPLATE_ID}; Error: ${JSON.stringify(error)}`);
  }

  try{
    folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  }
  catch(error){
    console.log(`[createRecipeDoc] Unable to access the Export Drive Folder. ID provided was ${CONFIG.FOLDER_ID}; Error: ${JSON.stringify(error)}`);
  }  

  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // 1. Title Replacement & Auto-Shrink Logic
  const titleText = (recipe.title || '').toUpperCase();
  const titlePlaceholder = body.findText('{{TITLE}}');
  if (titlePlaceholder) {
    const textElement = titlePlaceholder.getElement().asText();
    textElement.setText(titleText);
    applyShrinkToFit(doc, textElement, titleText);
  }

  // 2. Standard Text Replacements
  body.replaceText('{{DESCRIPTION}}', recipe.description || 'A delicious home-cooked meal.');
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || 'N/A');
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || 'N/A');
  body.replaceText('{{SERVINGS}}', recipe.servings || '1-2');
  body.replaceText('{{CALORIES}}', recipe.calories || 'unknown');
  body.replaceText('{{TIPS}}', recipe.tips || 'No specific tips, just have fun!');

  // 3. Dynamic List Handling (Ingredients & Instructions)
  replacePlaceholderWithList(body, '{{INGREDIENTS}}', recipe.ingredients || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{INSTRUCTIONS}}', recipe.instructions || recipe.preparation || [], DocumentApp.GlyphType.NUMBER, true);

  // 4. Persistent Image Actuation
  processCloudflareImage(body, recipe, CF_ACCOUNT_ID, CF_TOKEN);

  doc.saveAndClose();
  const docUrl = 'https://docs.google.com/document/d/' + newFile.getId() + '/edit';

  if (typeof logExport === 'function') logExport(recipe, docUrl);
  return JSON.stringify({ docId: newFile.getId(), url: docUrl });
}

/**
 * Adjusts font size to prevent word-breaking based on page width.
 */
function applyShrinkToFit(doc, textElement, text) {
  const body = doc.getBody();
  const pageWidth = doc.getPageWidth();
  const marginL = doc.getMarginLeft();
  const marginR = doc.getMarginRight();
  const availableWidth = pageWidth - marginL - marginR;

  // Find the longest word to prevent it from splitting
  const words = text.split(/\s+/);
  const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, "");

  let currentSize = MAX_TITLE_FONT_SIZE;
  
  /**
   * Estimation Formula:
   * Width ≈ (Character Count) * (Font Size) * (Average Width Factor)
   * Factor 0.65 is conservative for bold Serif/Sans fonts to ensure no wrap.
   */
  while (currentSize > MIN_TITLE_FONT_SIZE) {
    const estimatedWordWidth = longestWord.length * currentSize * 0.65;
    if (estimatedWordWidth <= availableWidth) break;
    currentSize -= 2;
  }

  textElement.setFontSize(currentSize);
}

/**
 * Safely replaces a placeholder with a list, regardless of container type.
 */
function replacePlaceholderWithList(body, placeholder, items, glyphType, parseBold = false) {
  const rangeElement = body.findText(placeholder);
  if (!rangeElement) return;

  const placeholderElement = rangeElement.getElement();
  const container = placeholderElement.getParent();
  const parentContainer = container.getParent(); // Usually Body or TableCell
  const index = parentContainer.getChildIndex(container);

  items.forEach((item, i) => {
    // We insert into the parent container (Body) at the position of the placeholder
    const listItem = parentContainer.insertListItem(index + i, item);
    listItem.setGlyphType(glyphType);
    if (parseBold) processMarkdownBold(listItem.editAsText(), item);
  });

  // Remove the original container (could be a Paragraph or a ListItem)
  container.removeFromParent();
}

/**
 * Parses markdown-style **bold** and applies native Google Docs formatting.
 */
function processMarkdownBold(textElement, rawText) {
  const parts = rawText.split(/(\*\*.*?\*\*)/g);
  let cleanText = "";
  const boldRanges = [];

  parts.forEach(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const content = part.substring(2, part.length - 2);
      boldRanges.push({ start: cleanText.length, end: cleanText.length + content.length - 1 });
      cleanText += content;
    } else {
      cleanText += part;
    }
  });

  textElement.setText(cleanText);
  boldRanges.forEach(range => textElement.setBold(range.start, range.end, true));
}

/**
 * Cloudflare Image logic for persistence.
 */
function processCloudflareImage(body, recipe, accountId, token) {
  let finalImageUrl = recipe.imageUrl;
  if (!finalImageUrl) {
    body.replaceText('{{IMAGE}}', '');
    return;
  }

  try {
    const cfApiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;
    const uploadResponse = UrlFetchApp.fetch(cfApiUrl, {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: { url: finalImageUrl, metadata: JSON.stringify({ title: recipe.title }) }
    });

    const result = JSON.parse(uploadResponse.getContentText());
    if (result.success) finalImageUrl = result.result.variants[0];

    const resp = UrlFetchApp.fetch(finalImageUrl);
    const placeholder = body.findText('{{IMAGE}}');
    if (placeholder) {
      const img = placeholder.getElement().getParent().asParagraph().insertInlineImage(0, resp.getBlob());
      const width = 450;
      const height = Math.round((img.getHeight() / (img.getWidth() || 1)) * width);
      img.setWidth(width).setHeight(height);
      placeholder.getElement().asText().setText('');
    }
  } catch (e) {
    body.replaceText('{{IMAGE}}', '[Image Load Error]');
  }
}
