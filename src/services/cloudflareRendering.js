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
  if (!targetUrl) {
    return `[captureRecipeData] Error: No URL provided for capturing recipe data.`;
  }

  // --- EXECUTION ---
  try {
    // 1. Extract Markdown (Text & Structure)
    const markdownContent = fetchCloudflareMarkdown(targetUrl);

    // 2. Capture Screenshot (Visual of the finished food)
    // We use a mobile-like viewport to focus on the "Hero" image usually at the top
    const imageBlob = fetchCloudflareScreenshot(targetUrl);

    // 3. Save to Google Drive (Example Output)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    let exportFolder;

    /* Try to get create a new folder under the main export folder */
    try{
      exportFolder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    }
    catch(error){
      console.log(`[captureRecipeData] Unable to access the Export Drive Folder. ID provided was ${CONFIG.FOLDER_ID}; Error: ${JSON.stringify(error)}`);
    }  
    
    const folder = exportFolder.createFolder(`Recipe_Capture_${timestamp}`);

    folder.createFile('recipe.md', markdownContent, 'text/markdown');
    folder.createFile(imageBlob).setName('finished_dish.png');

    const message = `Success! Files saved to Drive folder: "${folder.getName()}"; Folder Url: ${folder.getUrl()}`;
    console.log(`[captureRecipeData] ${message}`);
    return message;

  } catch (error) {
    const errorMsg = `Error capturing recipe data: ${JSON.stringify(error)}`;
    console.log(`[captureRecipeData]  ${errorMsg}`);
    return errorMsg;
  }
}

/**
 * Calls Cloudflare /markdown endpoint
 */
function fetchCloudflareMarkdown(url) {
    // --- CONFIGURATION ---
  const token = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  const endpoint = `${CLOUDFLARE_BROWSER_RENDER_URL}/markdown`;

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

  if (response.getResponseCode() !== 200) {
    throw new Error(`[fetchCloudflareMarkdown] Markdown API Failed: ${response.getContentText()}`);
  }

  const contentType = response.getHeaders()['Content-Type'] || '';
  if (contentType.includes('json')) {
    const json = JSON.parse(response.getContentText());
    return json.result || json;
  }

  return response.getContentText();
}

/**
 * Calls Cloudflare /screenshot endpoint
 */
function fetchCloudflareScreenshot(url) {
  // --- CONFIGURATION ---
  const token = CONFIG.CLOUDFLARE_BROWSER_RENDER_TOKEN;
  const endpoint = `${CLOUDFLARE_BROWSER_RENDER_URL}/screenshot`;

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

  if (response.getResponseCode() !== 200) {
    throw new Error(`[fetchCloudflareScreenshot] Screenshot API Failed: ${response.getContentText()}`);
  }

  return response.getBlob();
}
