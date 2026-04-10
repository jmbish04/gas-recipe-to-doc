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
  try {
    // Attempt to load and evaluate the template
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Recipe Assistant')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
      
  } catch (err) {
    // Log the error for server-side visibility
    console.error('CRITICAL: Failed to serve index.html.', err);
    logTelemetry('doGet', 'CRITICAL: Failed to serve index.html.', err);
    
    // Return the pretty error page matching the app's styling
    return HtmlService.createHtmlOutput(_getIndexErrorPage_(err))
      .setTitle('System Error - Recipe Assistant')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
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
function executeTool(toolName, argsStr, clientSessionId) {
  if (clientSessionId) CONFIG.SESSION_ID = clientSessionId;
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


/**
 * Generates an inline HTML error page that matches the Shadcn/Dark theme.
 * @param {Error} error The error object caught in doGet.
 * @return {string} The full HTML content for the error page.
 */
function _getIndexErrorPage_(error) {
  const errorMessage = error.message || 'The application resource "index" could not be found or loaded.';
  
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            background: '#09090b',
            foreground: '#fafafa',
            card: { DEFAULT: '#18181b', foreground: '#fafafa' },
            muted: { DEFAULT: '#27272a', foreground: '#a1a1aa' },
            accent: { DEFAULT: '#27272a', foreground: '#fafafa' }
          }
        }
      }
    };
  </script>
  <style>
    body { background-color: #09090b; color: #fafafa; font-family: ui-sans-serif, system-ui, sans-serif; }
    .error-card { border: 1px solid #27272a; }
  </style>
</head>
<body class="flex items-center justify-center min-h-screen p-4">
  <div class="max-w-md w-full error-card bg-[#18181b] rounded-xl p-8 shadow-2xl space-y-6 text-center">
    <div class="mx-auto w-12 h-12 rounded-full bg-red-900/20 flex items-center justify-center border border-red-900/30">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
    
    <div class="space-y-2">
      <h1 class="text-xl font-bold tracking-tight text-zinc-100">Application Error</h1>
      <p class="text-sm text-zinc-400 leading-relaxed">
        We encountered a problem while trying to load the <strong>Recipe Assistant</strong>.
      </p>
    </div>

    <div class="bg-zinc-950 rounded-lg p-4 border border-zinc-800 text-left">
      <p class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Error Details</p>
      <code class="text-xs text-red-400 break-words font-mono">${errorMessage}</code>
    </div>

    <div class="pt-4">
      <button onclick="window.location.reload()" class="w-full px-4 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 text-xs font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors">
        Try to Reload
      </button>
    </div>
    
    <p class="text-[10px] text-zinc-600">Please verify that the 'index.html' file exists in your project.</p>
  </div>
</body>
</html>`;
}

/**
 * Initializes a new session initiated by the frontend.
 * @returns {string} JSON containing the new session ID and folder details.
 */
function initializeSession() {
  const sessionId = Utilities.getUuid();
  const folderResponse = _createSessionFolder_(sessionId);
  return JSON.stringify({
    sessionId: sessionId,
    folderId: folderResponse.newSessionFolderId,
    folderUrl: folderResponse.newSessionFolderUrl
  });
}
