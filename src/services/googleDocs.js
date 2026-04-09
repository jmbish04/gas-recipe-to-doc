/**
 * @fileoverview Google Docs Actuation Service
 */

function createRecipeDoc(recipe) {
  let templateFile, folder;
  try { templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID); } catch(e) { console.error("Template access failed"); }
  try { folder = DriveApp.getFolderById(CONFIG.FOLDER_ID); } catch(e) { console.error("Folder access failed"); }

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
  replacePlaceholderWithList(body, '{{CHEF_INSIGHTS}}', recipe.chefInsights || [], DocumentApp.GlyphType.BULLET);

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
