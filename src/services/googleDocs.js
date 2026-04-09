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
  const CF_TOKEN = CONFIG.CLOUDFLARE_IMAGES_STREAM_TOKEN;
  const CF_ACCOUNT_ID = CONFIG.CLOUDFLARE_ACCOUNT_ID;

  let templateFile, folder;

  /* Try to obtain the template file and export folder */
  try {
    templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);
  }
  catch (error) {
    console.log(`[createRecipeDoc] Unable to access the Template Recipe Doc. ID provided was ${CONFIG.TEMPLATE_ID}; Error: ${JSON.stringify(error)}`);
  }

  try {
    folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  }
  catch (error) {
    console.log(`[createRecipeDoc] Unable to access the Export Drive Folder. ID provided was ${CONFIG.FOLDER_ID}; Error: ${JSON.stringify(error)}`);
  }

  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // 1. Title Replacement & Auto-Shrink Logic (Senior Engineer Aesthetic)
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
  replacePlaceholderWithList(body, '{{CULINARY_SCIENCE}}', recipe.culinaryScience || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{RESTAURANT_TECHNIQUES}}', recipe.restaurantTechniques || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{CHEF_INSIGHTS}}', recipe.chefInsights || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{TROUBLESHOOTING}}', recipe.troubleshooting || [], DocumentApp.GlyphType.BULLET);

  // 4. Persistent Image Actuation
  processCloudflareImage(body, recipe);

  // Mandatory save and close to flush changes immediately
  doc.saveAndClose();
  const docUrl = newFile.getUrl();

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

  const words = text.split(/\s+/);
  const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, "");

  let currentSize = MAX_TITLE_FONT_SIZE;
  
  while (currentSize > MIN_TITLE_FONT_SIZE) {
    const estimatedWordWidth = longestWord.length * currentSize * 0.65;
    if (estimatedWordWidth <= availableWidth) break;
    currentSize -= 2;
  }

  textElement.setFontSize(currentSize);
}

/**
 * Safely replaces a placeholder with a list and handles structural integrity.
 */
function replacePlaceholderWithList(body, placeholder, items, glyphType, parseBold = false) {
  const rangeElement = body.findText(placeholder);
  if (!rangeElement) return;

  const element = rangeElement.getElement();
  const container = element.getParent();
  const parent = container.getParent();
  const index = parent.getChildIndex(container);

  if (items && items.length > 0) {
    items.forEach((item, i) => {
      const listItem = parent.insertListItem(index + i, item);
      listItem.setGlyphType(glyphType);
      if (parseBold) processMarkdownBold(listItem.editAsText(), item);
    });
    // Structural Safety: Never leave a section without a paragraph
    try { container.removeFromParent(); } catch (e) { element.asText().setText(""); }
  } else {
    element.asText().setText("");
  }
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
 * Enhanced Image Injection: Specifically targets the Prepared Dish photo.
 */
function processCloudflareImage(body, recipe) {
  let finalImageUrl = recipe.imageUrl;
  if (!finalImageUrl) {
    body.replaceText('{{IMAGE}}', '');
    return;
  }

  try {
    // 1. Fetch the image blob from the Search/Cloudflare URL
    const imgResp = UrlFetchApp.fetch(finalImageUrl, { muteHttpExceptions: true });
    if (imgResp.getResponseCode() !== 200) throw new Error("Image fetch failed");
    
    const blob = imgResp.getBlob();
    const placeholder = body.findText('{{IMAGE}}');

    if (placeholder) {
      const para = placeholder.getElement().getParent().asParagraph();
      const img = para.insertInlineImage(0, blob);
      
      // Senior Engineer Aesthetic: Standardized Hero Width
      const targetWidth = 480;
      const ratio = targetWidth / img.getWidth();
      img.setWidth(targetWidth).setHeight(Math.round(img.getHeight() * ratio));
      
      placeholder.getElement().asText().setText('');
    }
  } catch (e) {
    console.warn(`[processCloudflareImage] Failed: ${e.message}`);
    body.replaceText('{{IMAGE}}', '');
  }
}
