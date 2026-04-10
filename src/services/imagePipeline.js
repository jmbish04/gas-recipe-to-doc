/**
 * @fileoverview Image Processing Pipeline
 * @module services/imagePipeline
 * @description Handles extracting (Scrape), finding (Search), or creating (AI) high-end recipe visuals.
 */

/**
 * Scrapes a URL and extracts images, excluding logos, ads, and small icons.
 */
function scrapeImagesFromUrl(targetUrl) {
  const startTime = Date.now();
  const fn = "scrapeImagesFromUrl";
  console.log(`[${fn}] START: ${targetUrl}`);
  logTelemetry(fn, "Function Started", { targetUrl });

  const apiToken = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  const endpoint = `${CONFIG.CLOUDFLARE_BROWSER_RENDER_URL}/scrape`;

  const payload = {
    url: targetUrl,
    elements: [{ selector: "img" }]
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": `Bearer ${apiToken}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const elapsed = Date.now() - startTime;
    console.log(`[${fn}] STEP: Browser Render response received (+${elapsed}ms)`);

    const data = JSON.parse(response.getContentText());
    if (!data.success) throw new Error(`Browser Rendering failed: ${JSON.stringify(data)}`);

    const imgScrapeData = (Array.isArray(data.result) ? data.result : []).find(r => r.selector === "img");
    let imageUrls = [];

    if (imgScrapeData && imgScrapeData.results) {
      // --- HEURISTIC FILTERING ---
      // Exclude obvious logos, ads, avatars, and icons based on URL patterns
      const blacklist = [/logo/i, /icon/i, /avatar/i, /ad-/i, /banner/i, /sprite/i, /loading/i, /\.gif/i, / Swasthis_Recipes_Logo/i];
      
      imageUrls = imgScrapeData.results
        .map(el => (el.attributes.find(a => a.name === "src") || {}).value)
        .filter(src => {
          if (!src || !src.startsWith('http')) return false;
          // Check if URL matches any blacklisted keywords
          const isJunk = blacklist.some(regex => regex.test(src));
          return !isJunk;
        });
    }

    console.log(`[${fn}] SUCCESS: Found ${imageUrls.length} valid images (+${Date.now() - startTime}ms)`);
    logTelemetry(fn, "Function Completed", { count: imageUrls.length, elapsed });
    return imageUrls;

  } catch (error) {
    console.error(`[${fn}] FAILED: ${error.message}`);
    logTelemetry(fn, "Scraping Error", error);
    return [];
  }
}

/**
 * Queries Google Custom Search with "Cinematic" filters and a Scoring Engine.
 */
function getRecipeImageUrl(recipeName) {
  const startTime = Date.now();
  const fn = "getRecipeImageUrl";
  console.log(`[${fn}] START: ${recipeName}`);
  logTelemetry(fn, "Function Started", { recipeName });

  // 1. STRATEGIC QUERY CONSTRUCTION
  // Using site-targeting and professional metadata keywords
  const professionalQuery = `site:unsplash.com OR site:pexels.com OR site:stockfood.com "${recipeName}" plated professional food photography cinematic lighting moody macro`;
  const endpoint = `https://customsearch.googleapis.com/customsearch/v1?q=${encodeURIComponent(professionalQuery)}&cx=${CONFIG.SEARCH_CX}&key=${CONFIG.SEARCH_API_KEY}&searchType=image&num=5&imgSize=xlarge&imgType=photo&imgDominantColor=black&safe=high`;

  try {
    const response = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    const elapsed = Date.now() - startTime;
    const data = JSON.parse(response.getContentText());

    if (!data.items || data.items.length === 0) {
      console.warn(`[${fn}] No cinematic results. Falling back to broad search.`);
      return null;
    }

    // 2. SCORING ENGINE
    const scoredImages = data.items.map(item => {
      let score = 0;
      const link = item.link || "";
      const title = (item.title || "").toLowerCase();
      const meta = item.image || {};

      // Domain Priority (+15)
      if (['unsplash.com', 'pexels.com', 'stockfood.com'].some(site => link.includes(site))) score += 15;
      
      // Keyword Density (+10)
      if (['plated', 'photography', 'moody', 'cinematic'].some(kw => title.includes(kw))) score += 10;

      // Resolution Bonus (+20 for 1920p, +10 for 1080p)
      if (meta.width >= 1920) score += 20;
      else if (meta.width >= 1080) score += 10;

      return { score, link };
    });

    // Sort by descending score
    scoredImages.sort((a, b) => b.score - a.score);
    const bestUrl = scoredImages[0].link;

    console.log(`[${fn}] SUCCESS: Scoring engine selected ${bestUrl} (Score: ${scoredImages[0].score})`);
    logTelemetry(fn, "Function Completed", { url: bestUrl, score: scoredImages[0].score, elapsed });
    return bestUrl;

  } catch (error) {
    console.error(`[${fn}] FAILED: ${error.message}`);
    logTelemetry(fn, "Search Error", error);
    return null;
  }
}

/**
 * FINAL FALLBACK: Generates a professional recipe photo via AI and uploads to Cloudflare.
 */
function createAndUploadRecipeImage(recipeName) {
  const fn = "createAndUploadRecipeImage";
  console.log(`[${fn}] START: Generating AI visual for ${recipeName}`);
  
  try {
    // Generate cinematic prompt
    const aiPrompt = `A professional food photograph of a gourmet ${recipeName}, plated on a dark ceramic plate, atmospheric lighting, chiaroscuro, shallow depth of field, macro shot, 8k resolution.`;
    
    // Call our established FLUX generator (defined in previous turn)
    const imageBlob = generateRecipeImageFlux2(aiPrompt);
    
    // Upload to persistent Cloudflare storage
    const cfUrl = uploadToCloudflareImages(imageBlob);
    
    logTelemetry(fn, "AI Generation Successful", { url: cfUrl });
    return cfUrl;
  } catch (e) {
    console.error(`[${fn}] Catastrophic Failure: ${e.message}`);
    logTelemetry(fn, "AI Generation Failed", e);
    return "";
  }
}

/**
 * High-Performance Orchestrator: Scrape -> Search -> Create
 */
function enrichRecipesWithImages(recipes) {
  const startTime = Date.now();
  console.log(`[enrichRecipesWithImages] START: Processing ${recipes.length} recipes.`);

  return recipes.map((recipe, idx) => {
    let finalUrl = "";

    // LEVEL 1: Browser Render Extraction
    const scraped = scrapeImagesFromUrl(recipe.sourceUrl);
    if (scraped.length > 0) {
      console.log(`[Enrich] Recipe ${idx+1}: Using scraped visual.`);
      finalUrl = scraped[0];
    }

    // LEVEL 2: Cinematic Google Search Fallback
    if (!finalUrl) {
      console.log(`[Enrich] Recipe ${idx+1}: Scrape failed. Triggering Cinematic Search.`);
      finalUrl = getRecipeImageUrl(recipe.title);
    }

    // LEVEL 3: Workers AI Generation Fallback
    if (!finalUrl) {
      console.log(`[Enrich] Recipe ${idx+1}: Search failed. Triggering AI Generation.`);
      finalUrl = createAndUploadRecipeImage(recipe.title);
    }

    // Final Persistence Check: Upload external URLs to Cloudflare
    if (finalUrl && !finalUrl.includes('imagedelivery.net')) {
      try {
        const blob = UrlFetchApp.fetch(finalUrl, { muteHttpExceptions: true }).getBlob();
        finalUrl = uploadToCloudflareImages(blob);
      } catch (e) {
        console.warn(`[Enrich] CF persistence failed for ${finalUrl}. Using raw link.`);
      }
    }

    recipe.imageUrl = finalUrl;
    return recipe;
  });
}

/**
 * Standard implementation for injection remains (processAndInjectRecipeImage, etc.)
 */
function processAndInjectRecipeImage(cloudflareImageUrl, docId) {
  if (!cloudflareImageUrl || !docId) return;
  try {
    const response = UrlFetchApp.fetch(cloudflareImageUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error("CF Fetch Failed");

    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    const placeholder = body.findText('{{IMAGE}}');
    
    if (placeholder) {
      injectAtExactPlaceholder(placeholder, response.getBlob(), 500);
    } else {
      appendAndScale(body, response.getBlob(), 500);
    }
    doc.saveAndClose();
  } catch (e) {
    console.error(`[DocInjection] Failed: ${e.message}`);
  }
}

function injectAtExactPlaceholder(rangeElement, blob, targetWidth) {
  const textElement = rangeElement.getElement().asText();
  const startOffset = rangeElement.getStartOffset();
  const endOffset = rangeElement.getEndOffsetInclusive();
  const parent = textElement.getParent();
  const img = parent.asParagraph().insertInlineImage(parent.getChildIndex(textElement) + 1, blob);
  textElement.deleteText(startOffset, endOffset);
  scaleImage(img, targetWidth);
}

/**
 * Fallback: Appends image to the end of the document.
 */
function appendAndScale(body, blob, targetWidth) {
  scaleImage(body.appendImage(blob), targetWidth);
}

/**
 * Maintains aspect ratio while scaling to target width.
 */
function scaleImage(img, targetWidth) {
  const ratio = targetWidth / (img.getWidth() || 1);
  img.setWidth(targetWidth);
  img.setHeight(Math.max(Math.round(img.getHeight() * ratio), 1));
}
