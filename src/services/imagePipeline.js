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
function scrapeImagesFromUrl(targetUrl, accountId, apiToken) {
  if (!targetUrl || !accountId || !apiToken) {
    throw new Error("Missing required parameters: targetUrl, accountId, or apiToken.");
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/scrape`;

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
      throw new Error(`Cloudflare API Error (${statusCode}): ${responseBody}`);
    }

    const data = JSON.parse(responseBody);

    if (!data.success) {
      throw new Error(`Browser Rendering failed: ${JSON.stringify(data.errors)}`);
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
    console.error("Error scraping images:", error);
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
function getRecipeImageUrl(recipeName, apiKey, searchEngineId) {
  if (!recipeName || !apiKey || !searchEngineId) {
    throw new Error("Missing required parameters: recipeName, apiKey, or searchEngineId.");
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
      throw new Error(`Google CSE API Error (${statusCode}): ${responseBody}`);
    }

    const data = JSON.parse(responseBody);

    if (data.items && data.items.length > 0 && data.items[0].link) {
      return data.items[0].link;
    }

    return null;

  } catch (error) {
    console.error("Error fetching recipe image:", error);
    throw error;
  }
}

/**
 * Uploads an image blob to Cloudflare Images API to get a persistent delivery URL.
 */
function uploadToCloudflareImages(rawImageBlob, accountId, apiToken) {
    const cfEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;

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
      throw new Error(`Cloudflare Images API Error (${cfStatusCode}): ${cfResponseBody}`);
    }

    const cfData = JSON.parse(cfResponseBody);
    if (!cfData.success) {
      throw new Error(`Cloudflare Images upload failed: ${JSON.stringify(cfData.errors)}`);
    }

    const variants = cfData.result.variants;
    if (!variants || variants.length === 0) {
      throw new Error("No variants returned from Cloudflare Images.");
    }

    return variants.find(v => v.endsWith("/public")) || variants[0];
}

/**
 * Iterates through the given recipes, attempts to extract or search an image,
 * uploads it to cloudflare and assigns the persistent URL.
 * @param {Array} recipes - The list of proposed recipes.
 * @returns {Array} - The recipes augmented with Cloudflare delivery image URLs.
 */
function enrichRecipesWithImages(recipes) {
  const props = PropertiesService.getScriptProperties();
  const CLOUDFLARE_ACCOUNT_ID = props.getProperty('CLOUDFLARE_ACCOUNT_ID');
  const CLOUDFLARE_BROWSER_TOKEN = props.getProperty('CLOUDFLARE_BROWSER_RENDER_TOKEN');
  const CLOUDFLARE_IMAGES_TOKEN = props.getProperty('CLOUDFLARE_IMAGES_STREAM_TOKEN');
  const GOOGLE_API_KEY = props.getProperty('GOOGLE_SEARCH_API_KEY') || CONFIG.SEARCH_API_KEY;
  const GOOGLE_CX = props.getProperty('GOOGLE_SEARCH_CX') || CONFIG.SEARCH_CX;

  // For each recipe, try to get a raw image URL first
  const rawUrls = recipes.map(recipe => {
    let rawUrl = null;

    // 1. If we have a source URL, attempt to scrape image
    if (recipe.sourceUrl && CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_BROWSER_TOKEN) {
      try {
        const scrapedImages = scrapeImagesFromUrl(recipe.sourceUrl, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_BROWSER_TOKEN);
        if (scrapedImages && scrapedImages.length > 0) {
            // Select the most likely hero image - could be first large one, for now pick first
            rawUrl = scrapedImages[0];
        }
      } catch (err) {
        console.warn("Scraping failed for " + recipe.sourceUrl + ": " + err.message);
      }
    }

    // 2. Fallback to Google Image Search if no raw URL yet
    if (!rawUrl && GOOGLE_API_KEY && GOOGLE_CX) {
       try {
           rawUrl = getRecipeImageUrl(recipe.title, GOOGLE_API_KEY, GOOGLE_CX);
       } catch (err) {
           console.warn("Google Image Search failed for " + recipe.title + ": " + err.message);
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
          console.warn("Failed to bulk fetch image blobs: " + err.message);
      }
  }

  // Sequentially upload to Cloudflare Images API
  // Using sequential because UrlFetchApp.fetchAll does not easily support multipart/form-data natively with nested objects in array for Drive API blobs
  return recipes.map((recipe, index) => {
      let finalUrl = "";
      const blob = blobsMap[index];

      if (blob && CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_IMAGES_TOKEN) {
          try {
              finalUrl = uploadToCloudflareImages(blob, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_IMAGES_TOKEN);
          } catch (uploadErr) {
              console.warn("Failed to upload " + recipe.title + " image to CF: " + uploadErr.message);
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
  if (!cloudflareImageUrl || !docId) {
    throw new Error("Missing required parameters for image injection.");
  }

  try {
    const optimizedResponse = UrlFetchApp.fetch(cloudflareImageUrl, { muteHttpExceptions: true });
    if (optimizedResponse.getResponseCode() >= 400) {
      throw new Error(`Failed to fetch optimized image from Cloudflare: ${optimizedResponse.getResponseCode()}`);
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
