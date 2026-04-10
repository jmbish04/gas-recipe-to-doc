/**
 * @fileoverview System Logging & Telemetry
 * @module utils/logger
 * @description Manages historical data tracking and system telemetry by interfacing with Google Sheets.
 * Designed to fail gracefully without interrupting critical user-facing execution paths.
 */

/**
 * Formats and logs a successful recipe export event to the history telemetry.
 * @param {Object} recipeData - The structured recipe object.
 * @param {string} docUrl - The final Google Drive URL of the exported document.
 */
function logExport(recipeData, docUrl) {
  // Serialize specific metadata fields to prevent sheet cell bloat while retaining analytics value.
  const details = _prettyStringifyJsonObject_({
    description: recipeData.description,
    cookTime: recipeData.cookTime,
    prepTime: recipeData.prepTime,
    servings: recipeData.servings,
    // Calculate the array length dynamically to track data complexity.
    ingredientCount: (recipeData.ingredients || []).length
  });

  // Hand off the formatted payload to the internal raw logging function.
  _logToSheet_('export', recipeData.title, details, docUrl);
}

/**
 * Formats and logs console telemetry.
 * @param {string} functionName - The function name where the message is being logged from.
 * @param {string} errorMessage - The pretty error message.
 * @param {object} errorObject - The error object caught in the handler.
 */
function logTelemetry(functionName, errorMessage, errorObject) {
  // 1. Heuristic logic to determine if this entry represents an error state
  const isError = (function() {
    const msg = (errorMessage || "").toLowerCase();
    
    // Check for explicit Error instances
    if (errorObject instanceof Error) return true;
    
    // Check for common error keywords in the message
    const errorKeywords = ['error', 'fail', 'exception', 'invalid', 'rejected', 'unauthorized', 'timeout', 'critical'];
    if (errorKeywords.some(keyword => msg.includes(keyword))) return true;
    
    // Check for API-style error structures (e.g., { error: "...", code: 500 })
    if (errorObject && typeof errorObject === 'object') {
      if (errorObject.error || errorObject.errors || errorObject.stack) return true;
      if (errorObject.status && errorObject.status >= 400) return true;
      if (errorObject.code && (errorObject.code >= 400 || typeof errorObject.code === 'string')) {
        if (errorObject.code.toLowerCase().includes('err')) return true;
      }
    }
    
    return false;
  })();


    
  // Serialize specific metadata fields to prevent sheet cell bloat while retaining analytics value.
  const details = _prettyStringifyJsonObject_({
    timestamp: _getTimestampPstString_(),
    functionName: typeof functionName === 'function' ? functionName.name : functionName,
    errorMessage,
    errorObject,
    isError
  });

  // Hand off the formatted payload to the internal raw logging function.
  _logTelemetryToSheet_(functionName, errorMessage, _prettyStringifyJsonObject_(errorObject), details, isError);
}

/**
 * Retrieves the paginated history of search and export events for the frontend UI.
 * @returns {string} A JSON serialized array of normalized history objects, sorted newest-first.
 */
function getHistory(clientSessionId) {
  if (clientSessionId) CONFIG.SESSION_ID = clientSessionId;
  // Open the centralized logging spreadsheet via the Drive ID. (Hardcoded per requirement)
  const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);

  // Resolve the specific telemetry worksheet.
  const sheet = ss.getSheetByName(CONFIG.HISTORY_SHEET_NAME);

  // If the sheet doesn't exist or is empty (excluding headers), return an empty array safely.
  if (!sheet || sheet.getLastRow() < 2) {
    return JSON.stringify([]);
  }

  // Extract a 2D array of all data starting from row 2 to skip headers.
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();

  // Process the 2D array into an array of structured JS objects.
  const rows = data
    // Filter out malformed rows missing a primary timestamp.
    .filter(function(row) { return !!row[0]; })
    .map(function(row) {
      return {
        // Normalize the date object into an ISO string for universal client parsing.
        timestamp: row[0] ? new Date(row[0]).toISOString() : '',
        type: row[1] || '',
        name: row[2] || '',
        details: row[3] || '',
        url: row[4] || ''
      };
    })
    // Reverse the array to provide the optimal descending chronological order.
    .reverse();

  // Return the serialized array to the requesting client.
  return JSON.stringify(rows);
}

/**
 * Internal raw logging utility. Handles direct writes to the Google Sheet.
 * @private
 * @param {string} type - The telemetry event type (e.g., 'chat', 'export', 'search').
 * @param {string} name - Primary identifier for the event.
 * @param {string} details - Secondary metadata or serialized context.
 * @param {string} url - Associated system URL, if applicable.
 */
function _logToSheet_(type, name, details, url) {
  try {
    // Open the master logging spreadsheet. (Hardcoded per requirement)
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);

    // Attempt to resolve the specific worksheet.
    let sheet = ss.getSheetByName(CONFIG.HISTORY_SHEET_NAME);

    // Implement an auto-healing mechanism: if the sheet was deleted, recreate it instantly.
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.HISTORY_SHEET_NAME);
      // Inject standard column headers for the newly created sheet.
      sheet.appendRow(['Timestamp', 'Session ID', 'Type', 'Name', 'Details', 'URL']);
      // Freeze the top row to lock headers for visual scrolling.
      sheet.setFrozenRows(1);

      // Initialize full-column wrapping for the data columns D & E to ensure manual entries wrap.
      sheet.getRange("E:F").setWrap(true);
      
      // Standardize formatting for new sheet
      sheet.getRange(1, 1, 1, headers.length)
           .setBackground("#3c81f3")
           .setFontWeight("bold")
           .setFontColor('white');      
    }

    // Append the telemetry data array directly to the bottom of the active sheet.
    sheet.appendRow([
      new Date(), 
      CONFIG.SESSION_ID || "N/A", 
      type, 
      name, 
      details, 
      url
    ]);    

    // Dynamically fetch the last appended row and apply text wrapping to the "Details" (Col 5) and "url" (Col 6) cells.
    sheet.getRange(sheet.getLastRow(), 5, 1, 2).setWrap(true);
  } catch (logErr) {
    // Suppress catastrophic failure. Telemetry errors should NEVER crash the main execution loop.
    console.error(`[_logToSheet_] Failed to log to sheet "${CONFIG.HISTORY_SHEET_NAME}": ${JSON.stringify(logErr)}`);
  }
}


/**
 * Logs telemetry data to a centralized Google Sheet.
 * Includes session isolation and visual error highlighting.
 */
function _logTelemetryToSheet_(functionName, errorMessage, errorObject, details, isError) {
  try {
    // RESOLVE FUNCTION NAME: Extract only the name, avoiding source code bloat.
    let cleanFunctionName = "anonymous";
    if (typeof functionName === 'function') {
      cleanFunctionName = functionName.name || "anonymous";
    } else if (typeof functionName === 'string') {
      // If a full function source was passed, extract the name via Regex
      const nameMatch = functionName.match(/function\s+([a-zA-Z0-9_$]+)/);
      cleanFunctionName = nameMatch ? nameMatch[1] : functionName;
    }
    
    // Open the master logging spreadsheet.
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);

    // Attempt to resolve the telemetry worksheet.
    let sheet = ss.getSheetByName(CONFIG.TELEMETRY_SHEET_NAME);

    // Column Mapping:
    // 1: Timestamp | 2: Session ID | 3: Function Name | 4: Status | 5: Error Message | 6: Error Object | 7: Details
    const headers = ['Timestamp', 'Session ID', 'Function Name', 'Status', 'Error Message', 'Error Object', 'Details'];

    // Auto-healing: Recreate sheet if missing.
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.TELEMETRY_SHEET_NAME);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      
      // Standardize formatting for new sheet
      sheet.getRange("F:G").setWrap(true); 
      sheet.getRange(1, 1, 1, headers.length)
           .setBackground("#3c81f3")
           .setFontWeight("bold")
           .setFontColor('white');
    }

    // Prepare the status label
    const status = isError ? "ERROR" : "SUCCESS";

    // Append the telemetry data including the new Session ID and Status column
    sheet.appendRow([
      new Date(), 
      CONFIG.SESSION_ID || "N/A", 
      functionName, 
      status, 
      errorMessage || "", 
      errorObject || "", 
      details || ""
    ]);

    const lastRow = sheet.getLastRow();
    const rowRange = sheet.getRange(lastRow, 1, 1, headers.length);

    // Apply conditional formatting: Red highlight for errors
    if (isError) {
      rowRange.setBackground("#f4cccc"); // Light Red 3
      rowRange.setFontColor("#990000"); // Dark Red text
    }

    // Apply text wrapping to the complex data fields (Cols 6 & 7: Error Object and Details)
    sheet.getRange(lastRow, 6, 1, 2).setWrap(true);

  } catch (logErr) {
    // Suppress catastrophic failure to prevent telemetry loops from crashing the core logic.
    console.error(`[_logTelemetryToSheet_] Critical logging failure: ${logErr.message}`);
  }
}

/**
 * Retrieves the telemetry log specific to a given session ID.
 * @param {string} sessionId - The ID of the session to filter by.
 * @returns {string} A JSON serialized array of telemetry objects.
 */
function getSessionTelemetry(sessionId) {
  if (sessionId) CONFIG.SESSION_ID = sessionId;

  try {
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.TELEMETRY_SHEET_NAME);

    if (!sheet || sheet.getLastRow() < 2) {
      return JSON.stringify([]);
    }

    // Extract a 2D array of all data starting from row 2
    // Columns: Timestamp | Session ID | Function Name | Status | Error Message | Error Object | Details
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();

    const rows = data
      .filter(function(row) {
        return row[0] && row[1] === sessionId;
      })
      .map(function(row) {
        return {
          timestamp: row[0] ? new Date(row[0]).toISOString() : '',
          sessionId: row[1] || '',
          functionName: row[2] || '',
          status: row[3] || '',
          errorMessage: row[4] || '',
          errorObject: row[5] || '',
          details: row[6] || ''
        };
      })
      // Take the last 50 entries and reverse to show newest first
      .slice(-50)
      .reverse();

    return JSON.stringify(rows);
  } catch (err) {
    console.error(`[getSessionTelemetry] Error fetching telemetry: ${err.message}`);
    return JSON.stringify([]);
  }
}
