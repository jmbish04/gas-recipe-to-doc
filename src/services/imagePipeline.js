/**
 * @fileoverview Image Processing Pipeline
 * @module services/imagePipeline
 * @description Handles extracting, downloading, uploading to Cloudflare, and enriching recipes with images.
 */

/**
 * Scrapes a URL and extracts all image source URLs using the Cloudflare Browser Rendering API.
 * @param {string} targetUrl - The URL of the page to scrape.
 * @param {string} accountId - Your Cloudflare Account ID.
 * @param {string} apiToken - Your Cloudflare API Token (requires Browser Rendering Edit permissions).
 * @returns {string[]} An array of image URLs extracted from the page.
 */
function scrapeImagesFromUrl(targetUrl) {
  const apiToken = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  if (!targetUrl) {
    throw new Error(`[scrapeImagesFromUrl] Missing required parameter: targetUrl; We received ${targetUrl}`);
  }

  const endpoint = `${CONFIG.CLOUDFLARE_BROWSER_RENDER_URL}/scrape`;

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

    if (statusCode >= 400) {
      throw new Error(`[scrapeImagesFromUrl] Cloudflare API Error (${statusCode}): ${responseBody}`);
    }

    const data = JSON.parse(responseBody);

    if (!data.success) {
      throw new Error(`[scrapeImagesFromUrl] Browser Rendering failed: ${JSON.stringify(data)}`);
    }

    const imageUrls = [];

    const imgScrapeData = (Array.isArray(data.result) ? data.result : []).find(r => r.selector === "img");

    if (imgScrapeData && imgScrapeData.results) {
      imgScrapeData.results.forEach(element => {
        const srcAttr = element.attributes.find(attr => attr.name === "src");
        if (srcAttr && srcAttr.value) {
          imageUrls.push(srcAttr.value);
        }
      });
    }

    return imageUrls;

  } catch (error) {
    console.error("[scrapeImagesFromUrl] Error scraping images:", error);
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
  const apiKey = CONFIG.SEARCH_API_KEY;
  const searchEngineId = CONFIG.SEARCH_CX;
  
  if (!recipeName) {
    throw new Error(`[getRecipeImageUrl] Missing required parameter: recipeName. We received ${recipeName}`);
  }

  const searchQuery = encodeURIComponent(`${recipeName} prepared dish plated food photography`);

  const endpoint = `https://customsearch.googleapis.com/customsearch/v1?q=${searchQuery}&cx=${searchEngineId}&key=${apiKey}&searchType=image&num=1&imgSize=large&safe=high`;

  const options = {
    method: "get",
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (statusCode >= 400) {
      throw new Error(`[getRecipeImageUrl] Google CSE API Error (${statusCode}): ${responseBody}`);
    }

    const data = JSON.parse(responseBody);

    if (data.items && data.items.length > 0 && data.items[0].link) {
      return data.items[0].link;
    }

    return null;

  } catch (error) {
    console.error("[getRecipeImageUrl] Error fetching recipe image:", error);
    throw error;
  }
}

/**
 * Uploads an image blob to Cloudflare Images API to get a persistent delivery URL.
 */
function uploadToCloudflareImages(rawImageBlob) {
    const cfEndpoint = CONFIG.CLOUDFLARE_IMAGES_URL;
    const apiToken = CONFIG.CLOUDFLARE_IMAGES_STREAM_TOKEN;

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

    const cfResponse = UrlFetchApp.fetch(cfEndpoint, cfOptions);
    const cfStatusCode = cfResponse.getResponseCode();
    const cfResponseBody = cfResponse.getContentText();

    if (cfStatusCode >= 400) {
      throw new Error(`[uploadToCloudflareImages] Cloudflare Images API Error (${cfStatusCode}): ${cfResponseBody}`);
    }

    const cfData = JSON.parse(cfResponseBody);
    if (!cfData.success) {
      throw new Error(`[uploadToCloudflareImages] Cloudflare Images upload failed: ${JSON.stringify(cfData)}`);
    }

    const variants = cfData.result.variants;
    if (!variants || variants.length === 0) {
      throw new Error("[uploadToCloudflareImages] No variants returned from Cloudflare Images.");
    }

    const CLOUDFLARE_IMAGES_URL = variants.find(v => v.endsWith("/public")) || variants[0];
    console.log(`[uploadToCloudflareImages] Images successfully uploaded to cloudflare images api: ${CLOUDFLARE_IMAGES_URL}`);
    
    return CLOUDFLARE_IMAGES_URL;
}

/**
 * Iterates through the given recipes, attempts to extract or search an image,
 * uploads it to cloudflare and assigns the persistent URL.
 * @param {Array} recipes - The list of proposed recipes.
 * @returns {Array} - The recipes augmented with Cloudflare delivery image URLs.
 */
function enrichRecipesWithImages(recipes) {

  // For each recipe, try to get a raw image URL first
  const rawUrls = recipes.map(recipe => {
    let rawUrl = null;

    // 1. If we have a source URL, attempt to scrape image
    if (recipe.sourceUrl) {
      try {
        console.log(`[enrichRecipesWithImages] Scraping Recipe Url: ${recipe.sourceUrl}`);
        
        const scrapedImages = scrapeImagesFromUrl(recipe.sourceUrl);
        
        if (scrapedImages && scrapedImages.length > 0) {
            // Select the most likely hero image - could be first large one, for now pick first
            rawUrl = scrapedImages[0];
            console.log(`[enrichRecipesWithImages] Select the most likely hero image - could be first large one, for now pick first: ${rawUrl}`);
        }
      } catch (err) {
        console.warn(`[enrichRecipesWithImages] Scraping failed for ${recipe.sourceUrl}: ${JSON.stringify(err)}`);
      }
    }

    // 2. Fallback to Google Image Search if no raw URL yet
    if (!rawUrl) {
       try {
           rawUrl = getRecipeImageUrl(recipe.title);
       } catch (err) {
           console.warn(`[enrichRecipesWithImages] Google Image Search failed for ${recipe.title}: ${err.message}`);
       }
    }

    return rawUrl;
  });

  // Now we need to fetch the blobs and upload to Cloudflare.
  // We can use fetchAll for performance on downloading blobs.
  const blobRequests = rawUrls.map(url => {
      if (!url) return null;
      return { url: url, muteHttpExceptions: true };
  }).filter(r => r !== null);

  let blobsMap = {};
  if (blobRequests.length > 0) {
      try {
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
      } catch (err) {
          console.warn(`[enrichRecipesWithImages] Failed to bulk fetch image blobs: ${JSON.stringify(err)}`);
      }
  }

  // Sequentially upload to Cloudflare Images API
  // Using sequential because UrlFetchApp.fetchAll does not easily support multipart/form-data natively with nested objects in array for Drive API blobs
  return recipes.map((recipe, index) => {
      let finalUrl = "";
      const blob = blobsMap[index];

      if (blob) {
          try {
              finalUrl = uploadToCloudflareImages(blob);
          } catch (uploadErr) {
              console.warn(`[enrichRecipesWithImages] Failed to upload ${recipe.title} image to CF: ${JSON.stringify(uploadErr)}`);
              // Fallback to the raw URL if CF upload fails but we still want an image
              finalUrl = rawUrls[index] || "";
          }
      } else {
          finalUrl = rawUrls[index] || "";
      }

      recipe.imageUrl = finalUrl;
      return recipe;
  });
}

/**
 * Fetches a Cloudflare optimized image blob and injects it into a target Google Document.
 * @param {string} cloudflareImageUrl - The imagedelivery.net URL.
 * @param {string} docId - The Google Document ID.
 */
function processAndInjectRecipeImage(cloudflareImageUrl, docId) {
  if (!cloudflareImageUrl) throw new Error(`[processAndInjectRecipeImage] Missing required parameter: 'cloudflareImageUrl'; Here's what we received ${cloudflareImageUrl}`);
  if (!docId) throw new Error(`[processAndInjectRecipeImage] Missing required parameter: 'docId'; Here's what we received ${docId}`);

  try {
    const optimizedResponse = UrlFetchApp.fetch(cloudflareImageUrl, { muteHttpExceptions: true });
    if (optimizedResponse.getResponseCode() >= 400) {
      throw new Error(`[processAndInjectRecipeImage] Failed to fetch optimized image from Cloudflare: ${optimizedResponse.getResponseCode()}`);
    }
    const optimizedBlob = optimizedResponse.getBlob();

    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();

    const placeholder = body.findText('{{IMAGE}}');
    if (placeholder) {
      const element = placeholder.getElement();
      const parent = element.getParent();
      const img = parent.asParagraph().insertInlineImage(0, optimizedBlob);

      const width = 500;
      const originalWidth = img.getWidth() || 1;
      const height = Math.round((img.getHeight() / originalWidth) * width);

      img.setWidth(width).setHeight(Math.max(height, 1));
      element.asText().setText('');
    } else {
        const injectedImage = body.appendImage(optimizedBlob);
        const originalWidth = injectedImage.getWidth() || 1;
        const originalHeight = injectedImage.getHeight() || 1;
        const targetWidth = 500;
        const ratio = targetWidth / originalWidth;
        injectedImage.setWidth(targetWidth);
        injectedImage.setHeight(Math.max(Math.round(originalHeight * ratio), 1));
    }

    doc.saveAndClose();

    return cloudflareImageUrl;

  } catch (error) {
    console.error("Image injection pipeline failed:", error);
    throw error;
  }
}



/**
 * Orchestrates fetching from Cloudflare and precise injection into a Doc.
 * @param {string} cloudflareImageUrl - The delivery URL (e.g., https://imagedelivery.net/<ID>/<VARIANT>).
 * @param {string} docId - Target Google Document ID.
 * @returns {string} The processed URL for logging.
 */
function processAndInjectRecipeImage(cloudflareImageUrl, docId) {
  if (!cloudflareImageUrl) throw new Error(`[processAndInjectRecipeImage] Missing required parameter: 'cloudflareImageUrl'; Here's what we received ${cloudflareImageUrl}`);
  if (!docId) throw new Error(`[processAndInjectRecipeImage] Missing required parameter: 'docId'; Here's what we received ${docId}`);

  const TARGET_WIDTH = 500;
  
  try {
    // 1. Optimize the Fetch: Request only the width we need from Cloudflare
    // Assumes flexible variants are enabled or uses standard URL params
    const optimizedUrl = cloudflareImageUrl.includes('?') 
      ? `${cloudflareImageUrl}&width=${TARGET_WIDTH}` 
      : `${cloudflareImageUrl}/w=${TARGET_WIDTH}`;

    const response = UrlFetchApp.fetch(optimizedUrl, { 
      muteHttpExceptions: true,
      headers: { "Accept": "image/webp,image/png,image/*" }
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`[processAndInjectRecipeImage] Cloudflare delivery failed: ${response.getResponseCode()}`);
    }

    const imageBlob = response.getBlob();
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    const placeholder = body.findText('{{IMAGE}}');

    if (placeholder) {
      injectAtExactPlaceholder(placeholder, imageBlob, TARGET_WIDTH);
    } else {
      appendAndScale(body, imageBlob, TARGET_WIDTH);
    }

    doc.saveAndClose();
    return optimizedUrl;

  } catch (error) {
    console.error(`[processAndInjectRecipeImage]: ${JSON.stringify(error)}`);
    throw error;
  }
}

/**
 * Injects image exactly where the placeholder text is located.
 * Logic: Splits the text element to maintain "Certain Position" integrity.
 */
function injectAtExactPlaceholder(rangeElement, blob, targetWidth) {
  const textElement = rangeElement.getElement().asText();
  const startOffset = rangeElement.getStartOffset();
  const endOffset = rangeElement.getEndOffsetInclusive();
  const parent = textElement.getParent();
  
  // Calculate child index of the text node within the paragraph
  const childIndex = parent.getChildIndex(textElement);

  // If placeholder isn't the whole text, we handle the 'Surrounding Text' case
  // But for standard placeholders, we insert relative to the text node
  const img = parent.asParagraph().insertInlineImage(childIndex + 1, blob);
  
  // Clean up: Remove the placeholder text precisely
  textElement.deleteText(startOffset, endOffset);
  
  scaleImage(img, targetWidth);
}

/**
 * Fallback: Appends image to the end of the document.
 */
function appendAndScale(body, blob, targetWidth) {
  const img = body.appendImage(blob);
  scaleImage(img, targetWidth);
}

/**
 * Maintains aspect ratio while scaling to target width.
 */
function scaleImage(img, targetWidth) {
  const originalWidth = img.getWidth() || 1;
  const originalHeight = img.getHeight() || 1;
  const ratio = targetWidth / originalWidth;
  
  img.setWidth(targetWidth);
  img.setHeight(Math.max(Math.round(originalHeight * ratio), 1));
}
