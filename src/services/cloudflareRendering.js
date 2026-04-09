/**
 * @fileoverview Cloudflare Browser Rendering Integration
 * @module services/cloudflareRendering
 * @description Extracts recipe markdown and captures a screenshot of the finished dish
 * using Cloudflare Browser Rendering API.
 */

/**
 * Extracts recipe markdown and captures a screenshot of the finished dish
 * using Cloudflare Browser Rendering API.
 * @param {string} targetUrl - The recipe URL to process.
 * @returns {string} Result message indicating success or failure.
 */
function captureRecipeData(targetUrl) {
  const startTime = Date.now();
  console.log(`[captureRecipeData] START`);
  logTelemetry(captureRecipeData, 'Function started', { targetUrl: targetUrl });

  if (!targetUrl) {
    const errorMsg = `[captureRecipeData] Error: No URL provided for capturing recipe data.`;
    console.warn(errorMsg);
    logTelemetry(captureRecipeData, 'Missing targetUrl', { error: errorMsg });
    return errorMsg;
  }

  // --- EXECUTION ---
  try {
    // 1. Extract Markdown (Text & Structure)
    console.log(`[captureRecipeData] STEP: Fetching Cloudflare Markdown (+${Date.now() - startTime}ms)`);
    const markdownContent = fetchCloudflareMarkdown(targetUrl);

    // 2. Capture Screenshot (Visual of the finished food)
    // We use a mobile-like viewport to focus on the "Hero" image usually at the top
    console.log(`[captureRecipeData] STEP: Fetching Cloudflare Screenshot (+${Date.now() - startTime}ms)`);
    const imageBlob = fetchCloudflareScreenshot(targetUrl);

    // 3. Save to Google Drive (Example Output)
    console.log(`[captureRecipeData] STEP: Saving files to Google Drive (+${Date.now() - startTime}ms)`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    let exportFolder;

    /* Try to get create a new folder under the main export folder */
    try{
      exportFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    }
    catch(error){
      console.log(`[captureRecipeData] Unable to access the Export Drive Folder. ID provided was ${CONFIG.FOLDER_ID}; Error: ${JSON.stringify(error)}`);

      logTelemetry('captureRecipeData', 'Unable to access the Export Drive Folder', error)
    }  
    
    const folder = exportFolder.createFolder(`Recipe_Capture_${timestamp}`);

    folder.createFile('recipe.md', markdownContent, 'text/markdown');
    folder.createFile(imageBlob).setName('finished_dish.png');

    const message = `Success! Files saved to Drive folder: "${folder.getName()}"; Folder Url: ${folder.getUrl()}`;
    console.log(`[captureRecipeData] ${message}`);
    
    console.log(`[captureRecipeData] SUCCESS: Function completed (+${Date.now() - startTime}ms)`);
    logTelemetry(captureRecipeData, 'Function completed successfully', { message: message, elapsedMs: Date.now() - startTime });
    return message;

  } catch (error) {
    const errorMsg = `Error capturing recipe data: ${JSON.stringify(error)}`;
    console.log(`[captureRecipeData]  ${errorMsg}`);

    logTelemetry(captureRecipeData, 'Error capturing recipe data', error)
    return errorMsg;
  }
}

/**
 * Calls Cloudflare /markdown endpoint
 */
function fetchCloudflareMarkdown(url) {
  const startTime = Date.now();
  console.log(`[fetchCloudflareMarkdown] START`);
  logTelemetry(fetchCloudflareMarkdown, 'Function started', { url: url });

    // --- CONFIGURATION ---
  const token = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  const endpoint = `${CONFIG.CLOUDFLARE_BROWSER_RENDER_URL}/markdown`;
  
  const redactedEndpoint = typeof _redactUrl === 'function' ? _redactUrl(endpoint) : endpoint;
  console.log(`[fetchCloudflareMarkdown] Calling API: ${redactedEndpoint}`);

  const options = {
    'method': 'post',
    'headers': {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    'payload': JSON.stringify({
      'url': url
    }),
    'muteHttpExceptions': true
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  
  console.log(`[fetchCloudflareMarkdown] STEP: API response received (+${Date.now() - startTime}ms)`);
  console.log(`[fetchCloudflareMarkdown] Received from API: ${response.getContentText().substring(0, 500)}...`);

  if (response.getResponseCode() !== 200) {
    const apiError = new Error(`[fetchCloudflareMarkdown] Markdown API Failed: ${response.getContentText()}`);
    logTelemetry(fetchCloudflareMarkdown, 'Markdown API Failed', apiError);
    throw apiError;
  }

  const contentType = response.getHeaders()['Content-Type'] || '';
  if (contentType.includes('json')) {
    const json = JSON.parse(response.getContentText());
    const result = json.result || json;
    
    console.log(`[fetchCloudflareMarkdown] SUCCESS: Returning markdown content (+${Date.now() - startTime}ms)`);
    logTelemetry(fetchCloudflareMarkdown, 'Function completed successfully', { elapsedMs: Date.now() - startTime });
    return result;
  }

  const resultText = response.getContentText();
  console.log(`[fetchCloudflareMarkdown] SUCCESS: Returning markdown content (+${Date.now() - startTime}ms)`);
  logTelemetry(fetchCloudflareMarkdown, 'Function completed successfully', { elapsedMs: Date.now() - startTime });
  return resultText;
}

/**
 * Calls Cloudflare /screenshot endpoint
 */
function fetchCloudflareScreenshot(url) {
  const startTime = Date.now();
  console.log(`[fetchCloudflareScreenshot] START`);
  logTelemetry(fetchCloudflareScreenshot, 'Function started', { url: url });

  // --- CONFIGURATION ---
  const token = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  const endpoint = `${CONFIG.CLOUDFLARE_BROWSER_RENDER_URL}/screenshot`;
  
  const redactedEndpoint = typeof _redactUrl === 'function' ? _redactUrl(endpoint) : endpoint;
  console.log(`[fetchCloudflareScreenshot] Calling API: ${redactedEndpoint}`);

  const options = {
    'method': 'post',
    'headers': {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    'payload': JSON.stringify({
      'url': url,
      'viewport': {
        'width': 1080,   // Square-ish width for high quality
        'height': 1080   // Height enough to likely capture the main hero image
      },
      'fullPage': false  // Set false to capture just the viewport (hero image), true for whole recipe
    }),
    'muteHttpExceptions': true
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  
  console.log(`[fetchCloudflareScreenshot] STEP: API response received (+${Date.now() - startTime}ms)`);

  if (response.getResponseCode() !== 200) {
    const apiError = new Error(`[fetchCloudflareScreenshot] Screenshot API Failed: ${response.getContentText()}`);
    logTelemetry(fetchCloudflareScreenshot, 'Screenshot API Failed', apiError);
    throw apiError;
  }

  const blob = response.getBlob();
  console.log(`[fetchCloudflareScreenshot] SUCCESS: Returning screenshot blob (+${Date.now() - startTime}ms)`);
  logTelemetry(fetchCloudflareScreenshot, 'Function completed successfully', { elapsedMs: Date.now() - startTime });
  return blob;
}
