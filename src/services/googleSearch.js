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
  const startTime = Date.now();
  console.log(`[searchGoogleCustom] START`);
  logTelemetry(searchGoogleCustom, 'Function started', { query: query });

  // Construct the secure API endpoint utilizing the injected API and CX keys, encoding the query safely.
  const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.SEARCH_API_KEY}&cx=${CONFIG.SEARCH_CX}&q=${encodeURIComponent(query)}`;

  const redactedUrl = url.replace(/key=[^&]+/g, "key=[REDACTED]").replace(/cx=[^&]+/g, "cx=[REDACTED]");
  console.log(`[searchGoogleCustom] Calling API: ${redactedUrl} (+${Date.now() - startTime}ms)`);
  logTelemetry(searchGoogleCustom, 'Calling API', { url: redactedUrl });

  try {
    // Execute a synchronous HTTP GET request, suppressing native exceptions for manual error handling.
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    console.log(`[searchGoogleCustom] STEP: Response received from Google (+${Date.now() - startTime}ms)`);
    const resText = res.getContentText();
    console.log(`[searchGoogleCustom] Received from API: ${resText.substring(0, 500)}...`);

    // Parse the JSON response payload from Google.
    const json = JSON.parse(resText);
    console.log(`[searchGoogleCustom] STEP: Parsed JSON response (+${Date.now() - startTime}ms)`);

    // Evaluate if valid search items were returned in the payload.
    if (json.items && json.items.length > 0) {
      // Slice the results to the top 3 items to aggressively preserve LLM context window limits.
      const results = json.items.slice(0, 3).map(function(item) {
        // Map only the required semantic fields, discarding bloated metadata.
        return { title: item.title, snippet: item.snippet };
      });
      
      console.log(`[searchGoogleCustom] SUCCESS: Returning ${results.length} results (+${Date.now() - startTime}ms)`);
      logTelemetry(searchGoogleCustom, 'Function completed successfully', { resultCount: results.length, elapsedMs: Date.now() - startTime });
      
      // Serialize the optimized array to pass back into the AI context window.
      return JSON.stringify(results);
    }

    // Return a definitive string if no results match, preventing the AI from hallucinating data.
    console.log(`[searchGoogleCustom] SUCCESS: No results found (+${Date.now() - startTime}ms)`);
    logTelemetry(searchGoogleCustom, 'No results found', { elapsedMs: Date.now() - startTime });
    return "No results found.";
  } catch (e) {
    // Catch network or parsing errors and inform the AI so it can reason around the failure.
    console.warn(`[searchGoogleCustom] Search failed: ${JSON.stringify(e)}`);

    logTelemetry(searchGoogleCustom, 'Search failed', e)
    return `[searchGoogleCustom] Search failed: ${JSON.stringify(e)}`;
  }
}

/**
 * Searches the Google Custom Search Image index for high-resolution food photography.
 * @param {string} title - The recipe title used to seed the search query.
 * @returns {string|null} The raw URL of the image, or null if retrieval fails.
 */
function findRecipeImage(title) {
  const startTime = Date.now();
  console.log(`[findRecipeImage] START`);
  logTelemetry(findRecipeImage, 'Function started', { title: title });

  // Append specialized search modifiers to ensure the image meets aesthetic formatting standards.
  const query = encodeURIComponent(`${title} food photography high resolution`);

  // Construct the URL with specific parameters for image-only retrieval (searchType=image) and limit to 1 result.
  const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.SEARCH_API_KEY}&cx=${CONFIG.SEARCH_CX}&searchType=image&q=${query}&num=1`;

  const redactedUrl = url.replace(/key=[^&]+/g, "key=[REDACTED]").replace(/cx=[^&]+/g, "cx=[REDACTED]");
  console.log(`[findRecipeImage] Calling API: ${redactedUrl} (+${Date.now() - startTime}ms)`);
  logTelemetry(findRecipeImage, 'Calling API', { url: redactedUrl });

  try {
    // Execute the HTTP GET request.
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    console.log(`[findRecipeImage] STEP: Response received from Google Image Search (+${Date.now() - startTime}ms)`);
    
    const result = JSON.parse(response.getContentText());
    console.log(`[findRecipeImage] STEP: Parsed JSON response (+${Date.now() - startTime}ms)`);

    // Safely traverse the response object and extract the direct image link of the first result.
    const link = result.items && result.items.length > 0 ? result.items[0].link : null;
    
    console.log(`[findRecipeImage] SUCCESS: Returning link: ${link} (+${Date.now() - startTime}ms)`);
    logTelemetry(findRecipeImage, 'Function completed successfully', { link: link, elapsedMs: Date.now() - startTime });
    return link;
  } catch (e) {
    // Log the failure to the developer console but do not throw, allowing the system to degrade gracefully.
    console.warn(`[findRecipeImage] Image search failed: ${JSON.stringify(e)}`);

    logTelemetry(findRecipeImage, 'Image search failed', e)
    return null;
  }
}

/**
 * Searches the Google Custom Search Image index for multiple recipe titles concurrently.
 * @param {string[]} titles - Array of recipe titles to search for.
 * @returns {string[]} Array of image URLs corresponding to the titles (or empty string if not found).
 */
function findRecipeImagesBulk(titles) {
  const startTime = Date.now();
  console.log(`[findRecipeImagesBulk] START`);
  logTelemetry(findRecipeImagesBulk, 'Function started', { titleCount: (titles || []).length });

  if (!titles || titles.length === 0) {
    console.log(`[findRecipeImagesBulk] SUCCESS: Empty input list (+${Date.now() - startTime}ms)`);
    return [];
  }

  const requests = titles.map(function(title) {
    const query = encodeURIComponent(`${title} food photography high resolution`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.SEARCH_API_KEY}&cx=${CONFIG.SEARCH_CX}&searchType=image&q=${query}&num=1`;

    return {
      url: url,
      muteHttpExceptions: true
    };
  });

  console.log(`[findRecipeImagesBulk] STEP: Calling API Bulk for ${requests.length} titles (+${Date.now() - startTime}ms)`);
  logTelemetry(findRecipeImagesBulk, 'Calling API Bulk', { requestCount: requests.length });

  try {
    const responses = UrlFetchApp.fetchAll(requests);
    console.log(`[findRecipeImagesBulk] STEP: Bulk response received (+${Date.now() - startTime}ms)`);

    const results = responses.map(function(response) {
      if (response.getResponseCode() === 200) {
        const result = JSON.parse(response.getContentText());
        return result.items && result.items.length > 0 ? result.items[0].link : "";
      }
      return "";
    });

    console.log(`[findRecipeImagesBulk] SUCCESS: Returning ${results.length} links (+${Date.now() - startTime}ms)`);
    logTelemetry(findRecipeImagesBulk, 'Function completed successfully', { linkCount: results.length, elapsedMs: Date.now() - startTime });
    return results;
  } catch (e) {
    console.warn(`[findRecipeImagesBulk] Bulk image search failed: ${JSON.stringify(e)}`);

    logTelemetry(findRecipeImagesBulk, 'Bulk image search failed', e)
    return titles.map(function() { return ""; });
  }
}
