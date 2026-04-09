/**
 * @fileoverview Google Custom Search Services
 * @module services/googleSearch
 * @description Provides direct integration with the Google Custom Search API.
 * Empowers the AI agent with external data retrieval capabilities (web scraping and high-res imagery).
 */

/**
 * Executes a semantic search query against the Google Custom Search API to retrieve textual data.
 * @param {string} query - The search parameters determined by the AI model.
 * @returns {string} Stringified JSON array containing summarized title/snippet objects.
 */
function searchGoogleCustom(query) {
  // Construct the secure API endpoint utilizing the injected API and CX keys, encoding the query safely.
  const url = 'https://www.googleapis.com/customsearch/v1?key=' + CONFIG.SEARCH_API_KEY +
    '&cx=' + CONFIG.SEARCH_CX + '&q=' + encodeURIComponent(query);

  try {
    // Execute a synchronous HTTP GET request, suppressing native exceptions for manual error handling.
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    // Parse the JSON response payload from Google.
    const json = JSON.parse(res.getContentText());

    // Evaluate if valid search items were returned in the payload.
    if (json.items && json.items.length > 0) {
      // Slice the results to the top 3 items to aggressively preserve LLM context window limits.
      const results = json.items.slice(0, 3).map(function(item) {
        // Map only the required semantic fields, discarding bloated metadata.
        return { title: item.title, snippet: item.snippet };
      });
      // Serialize the optimized array to pass back into the AI context window.
      return JSON.stringify(results);
    }

    // Return a definitive string if no results match, preventing the AI from hallucinating data.
    return "No results found.";
  } catch (e) {
    // Catch network or parsing errors and inform the AI so it can reason around the failure.
    return "Search failed: " + e.message;
  }
}

/**
 * Searches the Google Custom Search Image index for high-resolution food photography.
 * @param {string} title - The recipe title used to seed the search query.
 * @returns {string|null} The raw URL of the image, or null if retrieval fails.
 */
function findRecipeImage(title) {
  // Append specialized search modifiers to ensure the image meets aesthetic formatting standards.
  const query = encodeURIComponent(title + ' food photography high resolution');

  // Construct the URL with specific parameters for image-only retrieval (searchType=image) and limit to 1 result.
  const url = 'https://www.googleapis.com/customsearch/v1?key=' + CONFIG.SEARCH_API_KEY +
    '&cx=' + CONFIG.SEARCH_CX + '&searchType=image&q=' + query + '&num=1';

  try {
    // Execute the HTTP GET request.
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const result = JSON.parse(response.getContentText());

    // Safely traverse the response object and extract the direct image link of the first result.
    return result.items && result.items.length > 0 ? result.items[0].link : null;
  } catch (e) {
    // Log the failure to the developer console but do not throw, allowing the system to degrade gracefully.
    console.warn('Image search failed: ' + e.message);
    return null;
  }
}

/**
 * Searches the Google Custom Search Image index for multiple recipe titles concurrently.
 * @param {string[]} titles - Array of recipe titles to search for.
 * @returns {string[]} Array of image URLs corresponding to the titles (or empty string if not found).
 */
function findRecipeImagesBulk(titles) {
  if (!titles || titles.length === 0) return [];

  const requests = titles.map(function(title) {
    const query = encodeURIComponent(title + ' food photography high resolution');
    const url = 'https://www.googleapis.com/customsearch/v1?key=' + CONFIG.SEARCH_API_KEY +
      '&cx=' + CONFIG.SEARCH_CX + '&searchType=image&q=' + query + '&num=1';

    return {
      url: url,
      muteHttpExceptions: true
    };
  });

  try {
    const responses = UrlFetchApp.fetchAll(requests);
    return responses.map(function(response) {
      if (response.getResponseCode() === 200) {
        const result = JSON.parse(response.getContentText());
        return result.items && result.items.length > 0 ? result.items[0].link : "";
      }
      return "";
    });
  } catch (e) {
    console.warn('Bulk image search failed: ' + e.message);
    return titles.map(function() { return ""; });
  }
}
