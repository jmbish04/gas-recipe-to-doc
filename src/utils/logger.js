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
  const details = JSON.stringify({
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
 * Retrieves the paginated history of search and export events for the frontend UI.
 * @returns {string} A JSON serialized array of normalized history objects, sorted newest-first.
 */
function getHistory() {
  // Open the centralized logging spreadsheet via the Drive ID. (Hardcoded per requirement)
  const ss = SpreadsheetApp.openById('15OZdqdenNGVASN_EjygVuQkpL6ldO_Lk-hDon7aszw4');

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
      sheet.appendRow(['Timestamp', 'Type', 'Name', 'Details', 'URL']);
      // Freeze the top row to lock headers for visual scrolling.
      sheet.setFrozenRows(1);
    }

    // Append the telemetry data array directly to the bottom of the active sheet.
    sheet.appendRow([new Date(), type, name, details, url]);
  } catch (logErr) {
    // Suppress catastrophic failure. Telemetry errors should NEVER crash the main execution loop.
    console.error('Failed to log to sheet: ' + logErr.message);
  }
}
