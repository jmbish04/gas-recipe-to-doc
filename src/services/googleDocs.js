/**
 * @fileoverview Google Docs Actuation Service
 */

function createRecipeDoc(recipe, clientSessionId) {
  if (clientSessionId) CONFIG.SESSION_ID = clientSessionId;
  const startTime = Date.now();
  console.log(`[createRecipeDoc] START`);
  logTelemetry(createRecipeDoc, 'Function started', { title: recipe.title });

  let templateFile, folder;
  const errors = [];

  console.log(`[createRecipeDoc] STEP: Resolving template and folder (+${Date.now() - startTime}ms)`);
  try { 
    templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID); 
  } catch(e) { 
    const err = `Template access failed: ${JSON.stringify(e)}`;
    errors.push(err);
    logTelemetry(createRecipeDoc, 'Template access failed', e);
  }

  try { 
    folder = DriveApp.getFolderById(CONFIG.FOLDER_ID); 
  } catch(e) { 
    const err = `Folder access failed: ${JSON.stringify(e)}`;
    errors.push(err);
    logTelemetry(createRecipeDoc, 'Folder access failed', e);
  }

  if(errors.length > 0){
    const errorMessage = `[createRecipeDoc] There have been blocking errors preventing the recipe from export to docs: ${errors.join('\n')}`;
    logTelemetry(createRecipeDoc, 'Blocking errors detected', { errors });
    throw new Error(errorMessage);
  }

  console.log(`[createRecipeDoc] STEP: Creating document copy (+${Date.now() - startTime}ms)`);
  const newFile = templateFile.makeCopy('Recipe: ' + recipe.title, folder);
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  console.log(`[createRecipeDoc] STEP: Performing text replacements (+${Date.now() - startTime}ms)`);
  // Replacements
  body.replaceText('{{TITLE}}', (recipe.title || '').toUpperCase());
  body.replaceText('{{DESCRIPTION}}', recipe.description || '');
  body.replaceText('{{COOK_TIME}}', recipe.cookTime || 'N/A');
  body.replaceText('{{PREP_TIME}}', recipe.prepTime || 'N/A');
  body.replaceText('{{SERVINGS}}', recipe.servings || '1-2');
  body.replaceText('{{CALORIES}}', recipe.calories || 'N/A');

  console.log(`[createRecipeDoc] STEP: Processing list placeholders (+${Date.now() - startTime}ms)`);
  // Lists
  replacePlaceholderWithList(body, '{{INGREDIENTS}}', recipe.ingredients || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{INSTRUCTIONS}}', recipe.instructions || [], DocumentApp.GlyphType.NUMBER, true);
  replacePlaceholderWithList(body, '{{CULINARY_SCIENCE}}', recipe.culinaryScience || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{RESTAURANT_TECHNIQUES}}', recipe.restaurantTechniques || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{CHEF_INSIGHTS}}', recipe.chefInsights || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{TROUBLESHOOTING}}', recipe.troubleshooting || [], DocumentApp.GlyphType.BULLET);

  // HERO IMAGE ACTIVATION
  console.log(`[createRecipeDoc] STEP: Activating Hero Image (+${Date.now() - startTime}ms)`);
  if (recipe.imageUrl) {
    try {
      console.log(`[createRecipeDoc] STEP: Injecting image: ${typeof _redactUrl === 'function' ? _redactUrl(recipe.imageUrl) : recipe.imageUrl} (+${Date.now() - startTime}ms)`);
      // Calls the global function defined in src/services/imagePipeline.gs
      processAndInjectRecipeImage(recipe.imageUrl, newFile.getId());
    } catch (e) {
      const errorMessage = `Doc image injection failed: ${JSON.stringify(e)}`;
      console.error(`[createRecipeDoc] ${errorMessage}`);

      logTelemetry(createRecipeDoc, 'Doc image injection failed', e);
      body.replaceText('{{IMAGE}}', `❌ ${errorMessage}`);
    }
  } else {
    const errorMessage = `recipe.imageUrl is NULL: ${recipe.imageUrl}`;
    console.error(`[createRecipeDoc] ${errorMessage}`);

    logTelemetry(createRecipeDoc, 'recipe.imageUrl is NULL', { imageUrl: recipe.imageUrl });
    body.replaceText('{{IMAGE}}', `❌ ${errorMessage}`);
  }

  console.log(`[createRecipeDoc] STEP: Saving and closing document (+${Date.now() - startTime}ms)`);
  doc.saveAndClose();
  const docUrl = newFile.getUrl();
  
  if (typeof logExport === 'function') {
    logExport(recipe, docUrl);
  }

  const result = JSON.stringify({ docId: newFile.getId(), url: docUrl });
  console.log(`[createRecipeDoc] SUCCESS: Document created successfully (+${Date.now() - startTime}ms)`);
  logTelemetry(createRecipeDoc, 'Function completed successfully', { docId: newFile.getId(), url: typeof _redactUrl === 'function' ? _redactUrl(docUrl) : docUrl, elapsedMs: Date.now() - startTime });
  
  return result;
}

function replacePlaceholderWithList(body, placeholder, items, glyphType, parseBold = false) {
  const startTime = Date.now();
  console.log(`[replacePlaceholderWithList] START: ${placeholder}`);
  logTelemetry(replacePlaceholderWithList, 'Function started', { placeholder, itemCount: (items || []).length });

  const rangeElement = body.findText(placeholder);
  if (!rangeElement) {
    console.log(`[replacePlaceholderWithList] STEP: Placeholder "${placeholder}" not found (+${Date.now() - startTime}ms)`);
    logTelemetry(replacePlaceholderWithList, 'Placeholder not found', { placeholder });
    return;
  }

  const element = rangeElement.getElement();
  const container = element.getParent();
  const parent = container.getParent();
  const index = parent.getChildIndex(container);

  if (items && items.length > 0) {
    console.log(`[replacePlaceholderWithList] STEP: Inserting ${items.length} items for "${placeholder}" (+${Date.now() - startTime}ms)`);
    items.forEach((item, i) => {
      const listItem = parent.insertListItem(index + i, item);
      listItem.setGlyphType(glyphType);
      if (parseBold) processMarkdownBold(listItem.editAsText(), item);
    });
    
    try {
      container.removeFromParent();
    } catch (e) {
      // SAFE REMOVE FALLBACK: Prevents section Paragraph requirement exception
      console.warn(`[replacePlaceholderWithList] STEP: Container removal failed, falling back to setText("") (+${Date.now() - startTime}ms)`);
      element.asText().setText("");
    }
  } else {
    console.log(`[replacePlaceholderWithList] STEP: No items provided for "${placeholder}", clearing text (+${Date.now() - startTime}ms)`);
    element.asText().setText("");
  }

  console.log(`[replacePlaceholderWithList] SUCCESS: "${placeholder}" processed (+${Date.now() - startTime}ms)`);
  logTelemetry(replacePlaceholderWithList, 'Function completed successfully', { placeholder, elapsedMs: Date.now() - startTime });
}

/**
 * Parses markdown-style **bold** and applies native Google Docs formatting.
 */
function processMarkdownBold(textElement, rawText) {
  const startTime = Date.now();
  console.log(`[processMarkdownBold] START`);
  
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

  console.log(`[processMarkdownBold] SUCCESS: (+${Date.now() - startTime}ms)`);
}
