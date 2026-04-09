/**
 * @fileoverview API Endpoints & Request Handlers
 * @module api/handlers
 * @description Exposes the primary HTTP triggers (doGet, doPost) for the Apps Script environment.
 * Handles incoming web app traffic, payload validation, and routes requests to the appropriate service modules.
 */

/**
 * Handles incoming HTTP GET requests to serve the single-page application (SPA).
 * @param {Object} e - The event parameter containing request details.
 * @returns {HtmlOutput} The evaluated HTML template for the frontend interface.
 */
function doGet(e) {
  // Create an HTML template from the 'index' file and evaluate it to inject backend variables.
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    // Set the browser tab title for the application.
    .setTitle('Recipe Assistant')
    // Allow the web app to be embedded in external iframes if necessary (ALLOWALL).
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    // Inject a responsive viewport meta tag to ensure mobile compatibility.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Handles incoming HTTP POST requests, acting as a direct endpoint for external integrations or agents.
 * @param {Object} e - The event parameter containing the POST payload.
 * @returns {TextOutput} A JSON-formatted text response indicating success or failure.
 */
function doPost(e) {
  try {
    // Parse the incoming JSON string from the POST request body into a JavaScript object.
    const data = JSON.parse(e.postData.contents);

    // Validate the presence of critical recipe fields to prevent malformed document generation.
    if (!data.title || !data.ingredients || !data.instructions) {
      // Throw an error immediately to halt execution and return a targeted failure message.
      throw new Error('Missing required recipe fields: title, ingredients, or instructions.');
    }

    // Pass the validated data to the document creation service and parse the resulting metadata.
    const result = JSON.parse(createRecipeDoc(data));

    // Construct a successful JSON response payload containing the new document ID and URL.
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      documentId: result.docId,
      url: result.url,
      // Inject an ISO timestamp for accurate client-side tracking and caching.
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    // Catch any validation or execution errors and return a structured failure payload.
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      // Extract and safely serialize the error message.
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Executes a tool remotely via google.script.run for the frontend step-by-step chat flow.
 * @param {string} toolName - The name of the tool to execute.
 * @param {string} argsStr - The JSON stringified arguments for the tool.
 * @returns {string} The result of the tool execution as a string.
 */
function executeTool(toolName, argsStr) {
  try {
    const args = JSON.parse(argsStr);
    const dispatcher = TOOL_DISPATCHER[toolName];
    if (dispatcher) {
      return dispatcher(args);
    } else {
      return "Unknown tool requested.";
    }
  } catch (err) {
    return "Error executing tool: " + err.message;
  }
}
