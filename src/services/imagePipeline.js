/**
 * @fileoverview Image Processing Pipeline
 * @module services/imagePipeline
 * @description Handles extracting, downloading, uploading to Cloudflare, and enriching recipes with images.
 */

/**
 * Scrapes a URL and extracts all image source URLs using the Cloudflare Browser Rendering API.
 * @param {string} targetUrl - The URL of the page to scrape.
 * @param {string} accountId - Your Account ID.
 * @param {string} apiToken - Your API Token (requires Browser Rendering Edit permissions).
 * @returns {string[]} An array of image URLs extracted from the page.
 */
function scrapeImagesFromUrl(targetUrl) {
  const startTime = Date.now();
  console.log(`[scrapeImagesFromUrl] START`);
  logTelemetry(scrapeImagesFromUrl, 'Function started', { targetUrl: targetUrl });

  const apiToken = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  if (!targetUrl) {
    const errorMsg = `[scrapeImagesFromUrl] Missing required parameter: targetUrl; We received ${targetUrl}`;
    console.error(errorMsg);
    logTelemetry(scrapeImagesFromUrl, 'Missing targetUrl', { error: errorMsg });
    throw new Error(errorMsg);
  }

  const endpoint = `${CONFIG.CLOUDFLARE_BROWSER_RENDER_URL}/scrape`;
  const redactedEndpoint = endpoint.replace(/Bearer\s+[^'"]+/g, "Bearer [REDACTED]");

  console.log(`[scrapeImagesFromUrl] Calling API: ${redactedEndpoint} (+${Date.now() - startTime}ms)`);
  logTelemetry(scrapeImagesFromUrl, 'Calling API', { url: redactedEndpoint });

  const payload = {
    url: targetUrl,
    elements: [
      { selector: "img" }
    ]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": `Bearer ${apiToken}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    console.log(`[scrapeImagesFromUrl] STEP: API response received with code ${statusCode} (+${Date.now() - startTime}ms)`);
    console.log(`[scrapeImagesFromUrl] Received from API: ${responseBody.substring(0, 500)}...`);

    if (statusCode >= 400) {
      const errorMsg = `[scrapeImagesFromUrl] Cloudflare API Error (${statusCode}): ${responseBody}`;
      logTelemetry(scrapeImagesFromUrl, 'Cloudflare API Error', { statusCode, responseBody });
      throw new Error(errorMsg);
    }

    const data = JSON.parse(responseBody);

    if (!data.success) {
      const errorMsg = `[scrapeImagesFromUrl] Browser Rendering failed: ${JSON.stringify(data)}`;
      logTelemetry(scrapeImagesFromUrl, 'Browser Rendering failed', data);
      throw new Error(errorMsg);
    }

    const imageUrls = [];

    const imgScrapeData = (Array.isArray(data.result) ? data.result : []).find(r => r.selector === "img");

    if (imgScrapeData && imgScrapeData.results) {
      console.log(`[scrapeImagesFromUrl] STEP: Extracting ${imgScrapeData.results.length} image elements (+${Date.now() - startTime}ms)`);
      imgScrapeData.results.forEach(element => {
        const srcAttr = element.attributes.find(attr => attr.name === "src");
        if (srcAttr && srcAttr.value) {
          imageUrls.push(srcAttr.value);
        }
      });
    }

    console.log(`[scrapeImagesFromUrl] SUCCESS: Scraped ${imageUrls.length} image urls (+${Date.now() - startTime}ms)`);
    logTelemetry(scrapeImagesFromUrl, 'Function completed successfully', { count: imageUrls.length, elapsedMs: Date.now() - startTime });
    return imageUrls;

  } catch (error) {
    console.error("[scrapeImagesFromUrl] Error scraping images:", error);
    
    logTelemetry(scrapeImagesFromUrl, 'Error scraping images', error)
    throw error;
  }
}

/**
 * Queries the Google Custom Search JSON API to retrieve a photo of a prepared dish.
 * @param {string} recipeName - The name of the recipe to search for.
 * @param {string} apiKey - Your Google Cloud API Key.
 * @param {string} searchEngineId - Your Programmable Search Engine ID.
 * @returns {string|null} The URL of the highest-ranking image, or null if no results exist.
 */
function getRecipeImageUrl(recipeName) {
  const startTime = Date.now();
  console.log(`[getRecipeImageUrl] START`);
  logTelemetry(getRecipeImageUrl, 'Function started', { recipeName: recipeName });

  const apiKey = CONFIG.SEARCH_API_KEY;
  const searchEngineId = CONFIG.SEARCH_CX;
  
  if (!recipeName) {
    const errorMsg = `[getRecipeImageUrl] Missing required parameter: recipeName. We received ${recipeName}`;
    console.error(errorMsg);
    logTelemetry(getRecipeImageUrl, 'Missing recipeName', { error: errorMsg });
    throw new Error(errorMsg);
  }

  const searchQuery = encodeURIComponent(`${recipeName} prepared dish plated food photography`);

  const endpoint = `https://customsearch.googleapis.com/customsearch/v1?q=${searchQuery}&cx=${searchEngineId}&key=${apiKey}&searchType=image&num=1&imgSize=large&safe=high`;
  const redactedEndpoint = endpoint.replace(/key=[^&]+/g, "key=[REDACTED]").replace(/cx=[^&]+/g, "cx=[REDACTED]");

  console.log(`[getRecipeImageUrl] Calling API: ${redactedEndpoint} (+${Date.now() - startTime}ms)`);
  logTelemetry(getRecipeImageUrl, 'Calling API', { url: redactedEndpoint });
  
  const options = {
    method: "get",
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();

    console.log(`[getRecipeImageUrl] STEP: API response received with code ${statusCode} (+${Date.now() - startTime}ms)`);

    if (statusCode >= 400) {
      const errorMsg = `[getRecipeImageUrl] Google CSE API Error (${statusCode}): ${responseBody}`;
      logTelemetry(getRecipeImageUrl, 'Google CSE API Error', { statusCode, responseBody });
      throw new Error(errorMsg);
    }

    const data = JSON.parse(responseBody);

    if (data.items && data.items.length > 0 && data.items[0].link) {
      const link = data.items[0].link;
      console.log(`[getRecipeImageUrl] SUCCESS: Returning link: ${link} (+${Date.now() - startTime}ms)`);
      logTelemetry(getRecipeImageUrl, 'Function completed successfully', { link: link, elapsedMs: Date.now() - startTime });
      return link;
    }

    console.log(`[getRecipeImageUrl] SUCCESS: No images on Google Image search (+${Date.now() - startTime}ms)`);
    logTelemetry(getRecipeImageUrl, 'No results found', { elapsedMs: Date.now() - startTime });
    return null;

  } catch (error) {
    console.error("[getRecipeImageUrl] Error fetching recipe image:", error);
    
    logTelemetry(getRecipeImageUrl, 'Error fetching recipe image', error)
    throw error;
  }
}

/**
 * Uploads an image blob to Cloudflare Images API to get a persistent delivery URL.
 */
function uploadToCloudflareImages(rawImageBlob) {
    const startTime = Date.now();
    console.log(`[uploadToCloudflareImages] START`);
    logTelemetry(uploadToCloudflareImages, 'Function started', { blobSize: rawImageBlob.getBytes().length });

    const cfEndpoint = CONFIG.CLOUDFLARE_IMAGES_URL;
    const apiToken = CONFIG.CLOUDFLARE_IMAGES_STREAM_TOKEN;

    const redactedEndpoint = cfEndpoint.replace(/Bearer\s+[^'"]+/g, "Bearer [REDACTED]");
    console.log(`[uploadToCloudflareImages] Calling API: ${redactedEndpoint} (+${Date.now() - startTime}ms)`);

    const cfPayload = {
      file: rawImageBlob,
      requireSignedURLs: "false"
    };

    const cfOptions = {
      method: "post",
      headers: {
        "Authorization": `Bearer ${apiToken}`
      },
      payload: cfPayload,
      muteHttpExceptions: true
    };

    try {
      const cfResponse = UrlFetchApp.fetch(cfEndpoint, cfOptions);
      const cfStatusCode = cfResponse.getResponseCode();
      const cfResponseBody = cfResponse.getContentText();

      console.log(`[uploadToCloudflareImages] STEP: API response received with code ${cfStatusCode} (+${Date.now() - startTime}ms)`);

      if (cfStatusCode >= 400) {
        const errorMsg = `[uploadToCloudflareImages] Cloudflare Images API Error (${cfStatusCode}): ${cfResponseBody}`;
        logTelemetry(uploadToCloudflareImages, 'Cloudflare API Error', { cfStatusCode, cfResponseBody });
        throw new Error(errorMsg);
      }

      const cfData = JSON.parse(cfResponseBody);
      if (!cfData.success) {
        const errorMsg = `[uploadToCloudflareImages] Cloudflare Images upload failed: ${JSON.stringify(cfData)}`;
        logTelemetry(uploadToCloudflareImages, 'Upload failed', cfData);
        throw new Error(errorMsg);
      }

      const variants = cfData.result.variants;
      if (!variants || variants.length === 0) {
        const errorMsg = "[uploadToCloudflareImages] No variants returned from Cloudflare Images.";
        logTelemetry(uploadToCloudflareImages, 'No variants returned', { data: cfData });
        throw new Error(errorMsg);
      }

      const CLOUDFLARE_IMAGES_URL = variants.find(v => v.endsWith("/public")) || variants[0];
      console.log(`[uploadToCloudflareImages] SUCCESS: Persistent URL: ${CLOUDFLARE_IMAGES_URL} (+${Date.now() - startTime}ms)`);
      logTelemetry(uploadToCloudflareImages, 'Function completed successfully', { url: CLOUDFLARE_IMAGES_URL, elapsedMs: Date.now() - startTime });
      
      return CLOUDFLARE_IMAGES_URL;
    } catch (error) {
      console.error("[uploadToCloudflareImages] Error:", error);
      
      logTelemetry(uploadToCloudflareImages, 'Error uploading image', error)
      throw error;
    }
}

/**
 * Iterates through the given recipes, attempts to extract or search an image,
 * uploads it to cloudflare and assigns the persistent URL.
 * @param {Array} recipes - The list of proposed recipes.
 * @returns {Array} - The recipes augmented with Cloudflare delivery image URLs.
 */
function enrichRecipesWithImages(recipes) {
  const startTime = Date.now();
  console.log(`[enrichRecipesWithImages] START`);
  logTelemetry(enrichRecipesWithImages, 'Function started', { recipeCount: (recipes || []).length });

  // For each recipe, try to get a raw image URL first
  const rawUrls = recipes.map((recipe, idx) => {
    let rawUrl = null;

    // 1. If we have a source URL, attempt to scrape image
    if (recipe.sourceUrl) {
      try {
        console.log(`[enrichRecipesWithImages] STEP: Scraping Recipe Url for recipe ${idx+1}: ${recipe.sourceUrl} (+${Date.now() - startTime}ms)`);
        
        const scrapedImages = scrapeImagesFromUrl(recipe.sourceUrl);
        
        if (scrapedImages && scrapedImages.length > 0) {
            // Select the most likely hero image - could be first large one, for now pick first
            rawUrl = scrapedImages[0];
            console.log(`[enrichRecipesWithImages] STEP: Scraped hero image for recipe ${idx+1}: ${rawUrl} (+${Date.now() - startTime}ms)`);
        }
      } catch (err) {
        console.warn(`[enrichRecipesWithImages] Scraping failed for ${recipe.sourceUrl}: ${JSON.stringify(err)}`);

        logTelemetry('enrichRecipesWithImages', 'Scraping failed', err)
      }
    }

    // 2. Fallback to Google Image Search if no raw URL yet
    if (!rawUrl) {
       try {
           console.log(`[enrichRecipesWithImages] STEP: Falling back to Google Search for recipe ${idx+1}: ${recipe.title} (+${Date.now() - startTime}ms)`);
           rawUrl = getRecipeImageUrl(recipe.title);
       } catch (err) {
           console.warn(`[enrichRecipesWithImages] Google Image Search failed for ${recipe.title}: ${err.message}`);

           logTelemetry('enrichRecipesWithImages', 'Google Image Search failed', err)
       }
    }

    return rawUrl;
  });

  // Now we need to fetch the blobs and upload to Cloudflare.
  // We can use fetchAll for performance on downloading blobs.
  console.log(`[enrichRecipesWithImages] STEP: Preparing batch fetch for image blobs (+${Date.now() - startTime}ms)`);
  const blobRequests = rawUrls.map(url => {
      if (!url) return null;
      return { url: url, muteHttpExceptions: true };
  }).filter(r => r !== null);

  let blobsMap = {};
  if (blobRequests.length > 0) {
      try {
          console.log(`[enrichRecipesWithImages] STEP: Bulk fetching ${blobRequests.length} image blobs (+${Date.now() - startTime}ms)`);
          const responses = UrlFetchApp.fetchAll(blobRequests);
          let responseIndex = 0;
          for (let i = 0; i < rawUrls.length; i++) {
              if (rawUrls[i]) {
                  const resp = responses[responseIndex++];
                  if (resp.getResponseCode() === 200) {
                      blobsMap[i] = resp.getBlob();
                  }
              }
          }
          console.log(`[enrichRecipesWithImages] STEP: Successfully fetched ${Object.keys(blobsMap).length} blobs (+${Date.now() - startTime}ms)`);
      } catch (err) {
          console.warn(`[enrichRecipesWithImages] Failed to bulk fetch image blobs: ${JSON.stringify(err)}`);

          logTelemetry('enrichRecipesWithImages', 'Bulk fetch failed', err)
      }
  }

  // Sequentially upload to Cloudflare Images API
  // Using sequential because UrlFetchApp.fetchAll does not easily support multipart/form-data natively with nested objects in array for Drive API blobs
  console.log(`[enrichRecipesWithImages] STEP: Uploading blobs to Cloudflare sequentially (+${Date.now() - startTime}ms)`);
  const results = recipes.map((recipe, index) => {
      let finalUrl = "";
      const blob = blobsMap[index];

      if (blob) {
          try {
              finalUrl = uploadToCloudflareImages(blob);
          } catch (uploadErr) {
              console.warn(`[enrichRecipesWithImages] Failed to upload ${recipe.title} image to CF: ${JSON.stringify(uploadErr)}`);
              
              logTelemetry('enrichRecipesWithImages', 'Cloudflare upload failed', uploadErr)
              // Fallback to the raw URL if CF upload fails but we still want an image
              finalUrl = rawUrls[index] || "";
          }
      } else {
          finalUrl = rawUrls[index] || "";
      }

      recipe.imageUrl = finalUrl;
      return recipe;
  });

  console.log(`[enrichRecipesWithImages] SUCCESS: Enriched ${results.length} recipes with images (+${Date.now() - startTime}ms)`);
  logTelemetry(enrichRecipesWithImages, 'Function completed successfully', { count: results.length, elapsedMs: Date.now() - startTime });
  return results;
}

/**
 * Fetches a Cloudflare optimized image blob and injects it into a target Google Document.
 * @param {string} cloudflareImageUrl - The imagedelivery.net URL.
 * @param {string} docId - The Google Document ID.
 */
function processAndInjectRecipeImage(cloudflareImageUrl, docId) {
  const startTime = Date.now();
  console.log(`[processAndInjectRecipeImage] START`);
  logTelemetry(processAndInjectRecipeImage, 'Function started', { url: cloudflareImageUrl, docId: docId });

  if (!cloudflareImageUrl) {
    const err = `[processAndInjectRecipeImage] Missing required parameter: 'cloudflareImageUrl'; Here's what we received ${cloudflareImageUrl}`;
    logTelemetry(processAndInjectRecipeImage, 'Missing cloudflareImageUrl', { error: err });
    throw new Error(err);
  }
  if (!docId) {
    const err = `[processAndInjectRecipeImage] Missing required parameter: 'docId'; Here's what we received ${docId}`;
    logTelemetry(processAndInjectRecipeImage, 'Missing docId', { error: err });
    throw new Error(err);
  }

  const TARGET_WIDTH = 500;
  
  try {
    // 1. Optimize the Fetch: Request only the width we need from Cloudflare
    // Assumes flexible variants are enabled or uses standard URL params
    const optimizedUrl = cloudflareImageUrl.includes('?') 
      ? `${cloudflareImageUrl}&width=${TARGET_WIDTH}` 
      : `${cloudflareImageUrl}/w=${TARGET_WIDTH}`;

    console.log(`[processAndInjectRecipeImage] Calling API: ${optimizedUrl} (+${Date.now() - startTime}ms)`);
    logTelemetry(processAndInjectRecipeImage, 'Fetching optimized image', { url: optimizedUrl });

    const response = UrlFetchApp.fetch(optimizedUrl, { 
      muteHttpExceptions: true,
      headers: { "Accept": "image/webp,image/png,image/*" }
    });

    console.log(`[processAndInjectRecipeImage] STEP: API response received with code ${response.getResponseCode()} (+${Date.now() - startTime}ms)`);

    if (response.getResponseCode() !== 200) {
      const errorMsg = `[processAndInjectRecipeImage] Cloudflare delivery failed: ${response.getResponseCode()}`;
      logTelemetry(processAndInjectRecipeImage, 'Cloudflare delivery failed', { statusCode: response.getResponseCode() });
      throw new Error(errorMsg);
    }

    const imageBlob = response.getBlob();
    console.log(`[processAndInjectRecipeImage] STEP: Opening document ${docId} (+${Date.now() - startTime}ms)`);
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    const placeholder = body.findText('{{IMAGE}}');

    if (placeholder) {
      console.log(`[processAndInjectRecipeImage] STEP: Injecting image at {{IMAGE}} placeholder (+${Date.now() - startTime}ms)`);
      injectAtExactPlaceholder(placeholder, imageBlob, TARGET_WIDTH);
    } else {
      console.log(`[processAndInjectRecipeImage] STEP: Placeholder not found, appending image to end (+${Date.now() - startTime}ms)`);
      appendAndScale(body, imageBlob, TARGET_WIDTH);
    }

    doc.saveAndClose();
    console.log(`[processAndInjectRecipeImage] SUCCESS: Image processing complete (+${Date.now() - startTime}ms)`);
    logTelemetry(processAndInjectRecipeImage, 'Function completed successfully', { elapsedMs: Date.now() - startTime });
    return optimizedUrl;

  } catch (error) {
    console.error(`[processAndInjectRecipeImage]: ${JSON.stringify(error)}`);
    
    logTelemetry(processAndInjectRecipeImage, 'Error injecting recipe image', error)
    throw error;
  }
}

/**
 * Injects image exactly where the placeholder text is located.
 * Logic: Splits the text element to maintain "Certain Position" integrity.
 */
function injectAtExactPlaceholder(rangeElement, blob, targetWidth) {
  const startTime = Date.now();
  console.log(`[injectAtExactPlaceholder] START`);

  const textElement = rangeElement.getElement().asText();
  const startOffset = rangeElement.getStartOffset();
  const endOffset = rangeElement.getEndOffsetInclusive();
  const parent = textElement.getParent();
  
  // Calculate child index of the text node within the paragraph
  const childIndex = parent.getChildIndex(textElement);

  // If placeholder isn't the whole text, we handle the 'Surrounding Text' case
  // But for standard placeholders, we insert relative to the text node
  console.log(`[injectAtExactPlaceholder] STEP: Inserting inline image into paragraph (+${Date.now() - startTime}ms)`);
  const img = parent.asParagraph().insertInlineImage(childIndex + 1, blob);
  
  // Clean up: Remove the placeholder text precisely
  console.log(`[injectAtExactPlaceholder] STEP: Removing placeholder text (+${Date.now() - startTime}ms)`);
  textElement.deleteText(startOffset, endOffset);
  
  scaleImage(img, targetWidth);
  console.log(`[injectAtExactPlaceholder] SUCCESS: (+${Date.now() - startTime}ms)`);
}

/**
 * Fallback: Appends image to the end of the document.
 */
function appendAndScale(body, blob, targetWidth) {
  const startTime = Date.now();
  console.log(`[appendAndScale] START`);
  const img = body.appendImage(blob);
  scaleImage(img, targetWidth);
  console.log(`[appendAndScale] SUCCESS: (+${Date.now() - startTime}ms)`);
}

/**
 * Maintains aspect ratio while scaling to target width.
 */
function scaleImage(img, targetWidth) {
  const startTime = Date.now();
  console.log(`[scaleImage] START: Scaling to ${targetWidth}px`);
  const originalWidth = img.getWidth() || 1;
  const originalHeight = img.getHeight() || 1;
  const ratio = targetWidth / originalWidth;
  
  img.setWidth(targetWidth);
  img.setHeight(Math.max(Math.round(originalHeight * ratio), 1));
  console.log(`[scaleImage] SUCCESS: New size ${img.getWidth()}x${img.getHeight()} (+${Date.now() - startTime}ms)`);
}


/**
 * Orchestrates generating an image from recipe text using FLUX.2, 
 * uploads it to Cloudflare Images, and returns the persistent delivery URL.
 * * @param {string} recipeText - The raw recipe text to generate an image for.
 * @returns {string} The Cloudflare Images delivery URL.
 */
function createAndUploadRecipeImage(recipeText) {
  const startTime = Date.now();
  console.log(`[createAndUploadRecipeImage] START`);
  logTelemetry(createAndUploadRecipeImage, 'Function started', { functionName: 'createAndUploadRecipeImage', recipeText, recipeTextLength: recipeText?.length });

  // 1. Wrap the raw text in photographic direction to optimize the VLM rendering
  const optimizedPrompt = ```
    Macro food photography, highly detailed, photorealistic. 
    A beautifully plated dish prepared exactly according to this recipe: "${recipeText}". 
    Studio lighting, shallow depth of field, 4k resolution, hyper-realistic food styling, appetizing, cinematic lighting.
  ```;

  try {
    // 2. Stream generation via FLUX.2 
    const imageBlob = generateRecipeImageFlux2(optimizedPrompt);

    // 3. Pass the generated blob directly to your existing Cloudflare Images pipeline
    console.log(`[createAndUploadRecipeImage] STEP: Uploading generated blob to Cloudflare Images (+${Date.now() - startTime}ms)`);
    const cfImageUrl = uploadToCloudflareImages(imageBlob);

    console.log(`[createAndUploadRecipeImage] SUCCESS: End-to-end generation and upload complete: ${cfImageUrl} (+${Date.now() - startTime}ms)`);
    logTelemetry(createAndUploadRecipeImage, 'Function completed successfully', { url: cfImageUrl, elapsedMs: Date.now() - startTime });

    return cfImageUrl;

  } catch (error) {
    console.error("[createAndUploadRecipeImage] Orchestration Error:", error);
    logTelemetry(createAndUploadRecipeImage, 'Orchestration Error', error);
    throw error;
  }
}
