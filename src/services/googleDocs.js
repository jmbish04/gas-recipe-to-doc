/**
 * @fileoverview Google Docs Actuation Service
 */

function createRecipeDoc(recipe) {
  let templateFile, folder;
  const errors = [];
  try { templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID); } catch(e) { errors.push(`Template access failed: ${JSON.stringify(e)}`); }
  try { folder = DriveApp.getFolderById(CONFIG.FOLDER_ID); } catch(e) { errors.push(`Folder access failed: ${JSON.stringify(e)}`); }

  if(errors.length > 0){
    const errorMessage = `[createRecipeDoc] There have been blocking errors preventing the recipe from export to docs: ${errors.join('\n'}`;
    throw new Error(errorMessage);
  }

  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // Replacements
  body.replaceText('{{TITLE}}', (recipe.title || '').toUpperCase());
  body.replaceText('{{DESCRIPTION}}', recipe.description || '');
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || 'N/A');
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || 'N/A');
  body.replaceText('{{SERVINGS}}', recipe.servings || '1-2');
  body.replaceText('{{CALORIES}}', recipe.calories || 'N/A');

  // Lists
  replacePlaceholderWithList(body, '{{INGREDIENTS}}', recipe.ingredients || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{INSTRUCTIONS}}', recipe.instructions || [], DocumentApp.GlyphType.NUMBER, true);
  replacePlaceholderWithList(body, '{{CULINARY_SCIENCE}}', recipe.culinaryScience || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{RESTAURANT_TECHNIQUES}}', recipe.restaurantTechniques || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{CHEF_INSIGHTS}}', recipe.chefInsights || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{TROUBLESHOOTING}}', recipe.troubleshooting || [], DocumentApp.GlyphType.BULLET);

  // HERO IMAGE ACTIVATION
  if (recipe.imageUrl) {
    try {
      // Calls the global function defined in src/services/imagePipeline.gs
      processAndInjectRecipeImage(recipe.imageUrl, newFile.getId());
    } catch (e) {
      console.warn("Doc image injection failed: " + e.message);
      body.replaceText('{{IMAGE}}', '');
    }
  } else {
    body.replaceText('{{IMAGE}}', '');
  }

  doc.saveAndClose();
  const docUrl = newFile.getUrl();
  if (typeof logExport === 'function') logExport(recipe, docUrl);
  return JSON.stringify({ docId: newFile.getId(), url: docUrl });
}

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
    try {
      container.removeFromParent();
    } catch (e) {
      // SAFE REMOVE FALLBACK: Prevents section Paragraph requirement exception
      element.asText().setText("");
    }
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
