/**
 * @fileoverview Image Processing Pipeline
 * @module services/imagePipeline
 * @description Handles extracting (Scrape), finding (Search), or creating (AI) high-end recipe visuals.
 */


/**
 * Uses Cloudflare Browser Rendering AI (/json) to extract the primary recipe image,
 * bypassing manual DOM heuristics in favor of LLM-driven structured extraction.
 */
function scrapeImagesFromUrl(targetUrl) {
  const startTime = Date.now();
  const fn = "scrapeImagesFromUrl";
  console.log(`[${fn}] START: ${targetUrl}`);
  logTelemetry(fn, "Function Started", { targetUrl });

  const apiToken = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  // Endpoint shifted from /scrape to /json to leverage Workers AI structured extraction
  const endpoint = `${CONFIG.CLOUDFLARE_BROWSER_RENDER_URL}/json`;

  const payload = {
    url: targetUrl,
    prompt: "Identify the single main, high-resolution food photograph representing the finished recipe on this page. Explicitly exclude site logos, author avatars, social media icons, sidebar widgets, and low-resolution thumbnails. Return the absolute URL of this best recipe image.",
    response_format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          imageUrl: {
            type: "string",
            description: "The absolute URL to the main recipe image."
          }
        },
        required: ["imageUrl"]
      }
    },
    gotoOptions: {
      // Ensure SPA/JavaScript heavy recipe sites finish loading dynamic images before extraction
      waitUntil: "networkidle2"
    }
  };

  console.log(`[${fn}] Browser Render /json payload: ${payload}`);
  logTelemetry(fn, `Browser Render /json payload`, payload);
  

  try {
    const response = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": `Bearer ${apiToken}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const elapsed = Date.now() - startTime;
    console.log(`[${fn}] STEP: Browser Render AI response received (+${elapsed}ms)`);

    const data = JSON.parse(response.getContentText());
    if (!data.success) throw new Error(`Browser Rendering /json failed: ${JSON.stringify(data)}`);

    // The /json endpoint maps the JSON schema directly into data.result
    const extractedUrl = data.result?.imageUrl;
    let imageUrls = [];

    if (extractedUrl && extractedUrl.startsWith('http')) {
      imageUrls.push(extractedUrl);
    }

    console.log(`[${fn}] SUCCESS: Extracted AI image URL (+${Date.now() - startTime}ms)`);
    logTelemetry(fn, "Function Completed", { count: imageUrls.length, extractedUrl, elapsed });
    
    return imageUrls;

  } catch (error) {
    console.error(`[${fn}] FAILED: ${error.message}`);
    logTelemetry(fn, "Scraping Error", error);
    return [];
  }
}



/**
 * Scrapes a URL and extracts images, excluding logos, ads, and small icons.
 */
function scrapeImagesFromUrlLinks(targetUrl) {
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
      const blocklist = [
        /logo/i, /icon/i, /avatar/i, /ad-/i, /banner/i, /sprite/i, /loading/i, /\.gif/i, /Swasthis_Recipes_Logo/i,
        /social/i, /header/i, /button/i, /widget/i, /theme/i, /about/i, /search/i, /96x96/i, /\-\d+x\d+\./i
      ];
      imageUrls = imgScrapeData.results
        .map(el => (el.attributes.find(a => a.name === "src") || {}).value)
        .filter(src => {
          if (!src || !src.startsWith('http')) return false;
          // Check if URL matches any blocklist keywords
          const isJunk = blocklist.some(regex => regex.test(src));
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
      logTelemetry(fn, "No cinematic results. Falling back to broad search.", data);
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
  const fnName = 'enrichRecipesWithImages';
  console.log(`[${fnName}] START: Processing ${recipes.length} recipes.`);
  logTelemetry(fnName, 'START: Processing ${recipes.length} recipes.', recipes);

  return recipes.map((recipe, idx) => {
    let finalUrl = "";

    // LEVEL 1: Browser Render Extraction
    const scraped = scrapeImagesFromUrl(recipe.sourceUrl);
    if (scraped.length > 0) {
      console.log(`[Enrich] Recipe ${idx+1}: Using scraped visual.`);
      logTelemetry(fnName, `[Enrich LEVEL 1] Recipe ${idx+1}: Using scraped visual.`, scraped);
      finalUrl = scraped[0];
    }

    // LEVEL 2: Cinematic Google Search Fallback
    if (!finalUrl) {
      console.log(`[Enrich] Recipe ${idx+1}: Scrape failed. Triggering Cinematic Search.`);
      logTelemetry(fnName, `[Enrich LEVEL 2] Recipe ${idx+1}: Scrape failed. Triggering Cinematic Search.`, scraped);
      finalUrl = getRecipeImageUrl(recipe.title);
    }

    // LEVEL 3: Workers AI Generation Fallback
    if (!finalUrl) {
      console.log(`[Enrich] Recipe ${idx+1}: Search failed. Triggering AI Generation.`);
      logTelemetry(fnName, `[Enrich LEVEL 3] Recipe ${idx+1}: Search failed. Triggering AI Generation.`, scraped);
      finalUrl = createAndUploadRecipeImage(recipe.title);
    }

    // Final Persistence Check: Upload external URLs to Cloudflare
    // DEFENSIVE CHECK: finalUrl must be a non-empty string and a valid URL
    if (finalUrl && typeof finalUrl === 'string' && finalUrl.startsWith('http') && !finalUrl.includes('imagedelivery.net')) {
      try {
        console.log(`[${fnName}] STEP: Persisting external URL to Cloudflare: ${finalUrl}`);
        logTelemetry(fnName, `STEP: Persisting external URL to Cloudflare: ${finalUrl}`, scraped);
        const response = UrlFetchApp.fetch(finalUrl, { muteHttpExceptions: true });
        if (response.getResponseCode() === 200) {
          finalUrl = uploadToCloudflareImages(response.getBlob());
        }
      } catch (e) {
        console.warn(`[${fnName}] WARNING: CF persistence failed for ${finalUrl}. Error: ${e.message}`);
        logTelemetry(fnName, "Cloudflare Images API Persistence Failed", { url: finalUrl, error: e });
      }
    }

    recipe.imageUrl = finalUrl;
    return recipe;
  });
}

/**
 * Uploads an image blob to Cloudflare and backs up both raw and optimized versions to Google Drive.
 * @param {GoogleAppsScript.Base.Blob} rawImageBlob - The original image data.
 * @returns {string} The persistent Cloudflare delivery URL.
 */
function uploadToCloudflareImages(rawImageBlob) {
  const startTime = Date.now();
  const fnName = "uploadToCloudflareImages";
  console.log(`[${fnName}] START`);
  logTelemetry(fnName, 'START');
  
  let rawDriveUrl = "";
  let optimizedDriveUrl = "";
  let cloudflareImageUrl = "";

  // 1. Save Raw Image to Google Drive
  try {
    const sessionFolder = DriveApp.getFolderById(CONFIG.SESSION_FOLDER_ID);
    rawImageBlob.setName(`RAW_${rawImageBlob.getName() || "image.jpg"}`);
    const rawFile = sessionFolder.createFile(rawImageBlob);
    rawDriveUrl = rawFile.getUrl();
    logTelemetry(fnName, `Session Folder Url: ${CONFIG.SESSION_FOLDER_URL}`);
    logTelemetry(fnName,`STEP: Raw image saved to Drive: ${rawDriveUrl}`);
  } catch (driveErr) {
    console.warn(`[${fnName}] WARNING: Failed to save RAW image to Drive: ${driveErr.message}`);
    logTelemetry(fnName, "Drive Save Failed (Raw)", driveErr);
  }

  // 2. Upload to Cloudflare Images
  const cfEndpoint = CONFIG.CLOUDFLARE_IMAGES_URL;
  const apiToken = CONFIG.CLOUDFLARE_IMAGES_STREAM_TOKEN;

  if (!cfEndpoint) {
    logTelemetry(fnName, "Missing CONFIG.CLOUDFLARE_IMAGES_URL");
    throw new Error(`[${fnName}] Missing CONFIG.CLOUDFLARE_IMAGES_URL`);
  }

  const cfOptions = {
    method: "post",
    headers: { "Authorization": `Bearer ${apiToken}` },
    payload: { file: rawImageBlob, requireSignedURLs: "false" },
    muteHttpExceptions: true
  };

  try {
    console.log(`[${fnName}] STEP: Calling Cloudflare Images API (+${Date.now() - startTime}ms)`);
    logTelemetry(fnName,`STEP: Calling Cloudflare Images API (+${Date.now() - startTime}ms)`);
    const cfResponse = UrlFetchApp.fetch(cfEndpoint, cfOptions);
    
    if (cfResponse.getResponseCode() !== 200) {
      logTelemetry(fnName,`ERROR: Cloudflare Images API Error (${cfResponse.getResponseCode()}): ${cfResponse.getContentText()}`);
      throw new Error(`[${fnName}] Cloudflare Images API Error (${cfResponse.getResponseCode()}): ${cfResponse.getContentText()}`);
    }

    const cfData = JSON.parse(cfResponse.getContentText());
    if (!cfData.success){
      const errorMessage = `Cloudflare upload failed: ${JSON.stringify(cfData)}`;
      logTelemetry(fnName, errorMessage, cfData);
      throw new Error(`[${fnName}] ${errorMessage}`);
    }

    // Use the /public variant as the standard "pre-custom-optimization" Cloudflare URL
    cloudflareImageUrl = cfData.result.variants.find(v => v.endsWith("/public")) || cfData.result.variants[0];
    if (!cloudflareImageUrl) {
      logTelemetry(fnName, `Cloudflare upload succeeded but no public variant URL was returned.`, cfData);
      throw new Error(`[${fnName}] Cloudflare upload succeeded but no public variant URL was returned.`);
    }
    else {
      logTelemetry(fnName, `STEP: Uploaded to Cloudflare: ${cloudflareImageUrl} (+${Date.now() - startTime}ms)`);
    }

    // 3. Fetch Optimized Image from Cloudflare and Save to Google Drive
    try {
      // We fetch the image back from Cloudflare to get the "optimized" binary
      console.log(`[${fnName}] STEP: Fetching optimized blob from Cloudflare...`);
      logTelemetry(fnName, `STEP: Fetching optimized blob from Cloudflare...`);
      const optimizedResponse = UrlFetchApp.fetch(cloudflareImageUrl, { muteHttpExceptions: true });
      
      if (optimizedResponse.getResponseCode() === 200) {
        const optimizedBlob = optimizedResponse.getBlob().setName(`OPTIMIZED_${rawImageBlob.getName() || "image.jpg"}`);
        const sessionFolder = DriveApp.getFolderById(CONFIG.SESSION_FOLDER_ID);
        const optFile = sessionFolder.createFile(optimizedBlob);
        optimizedDriveUrl = optFile.getUrl();
        console.log(`[${fnName}] STEP: Optimized image saved to Drive: ${optimizedDriveUrl}`);
        logTelemetry(fnName, `STEP: Optimized image saved to Drive: ${optimizedDriveUrl}`);
      }
    } catch (optDriveErr) {
      console.warn(`[${fnName}] WARNING: Failed to save OPTIMIZED image to Drive: ${optDriveErr.message}`);
      logTelemetry(fnName, "Drive Save Failed (Optimized)", optDriveErr);
    }

    // 4. Comprehensive Telemetry Log
    const telemetryData = {
      elapsedMs: Date.now() - startTime,
      cloudflareUrl: cloudflareImageUrl,
      rawDriveUrl: rawDriveUrl,
      optimizedDriveUrl: optimizedDriveUrl,
      sessionFolderUrl: CONFIG.SESSION_FOLDER_URL, // Requirement 3: Log folder URL
      blobSize: rawImageBlob.getBytes().length
    };

    console.log(`[${fnName}] SUCCESS: Image processing complete (+${Date.now() - startTime}ms)`);
    logTelemetry(fnName, "Image Upload Cycle Complete", telemetryData);
    
    return cloudflareImageUrl;

  } catch (error) {
    console.error(`[${fnName}] CRITICAL ERROR: ${error.message}`);
    logTelemetry(fnName, "Cloudflare Upload Failed", error);
    throw error;
  }
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
  } catch (error) {
    console.error(`[DocInjection] Failed: ${error.message}`);
    logTelemetry('processAndInjectRecipeImage', "[DocInjection] Failed:", error);
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
