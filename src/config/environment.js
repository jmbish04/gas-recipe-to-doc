/**
 * @fileoverview Environment & Configuration Module
 * @module config/environment
 * @description Centralized configuration registry managing external integrations, API keys, and service routing.
 * Implements a self-healing fallback pattern by safely defaulting missing properties where appropriate.
 */

// Initialize the PropertiesService to retrieve environment variables from Google Apps Script.
const scriptProps = PropertiesService.getScriptProperties();

// Safely extract the Cloudflare Account ID or fallback to a placeholder to prevent immediate catastrophic failure.
const CF_ACCOUNT_ID = scriptProps.getProperty('CLOUDFLARE_ACCOUNT_ID');


// Extract the Cloudflare Auth Token for direct API calls
const CF_AUTH_TOKEN = scriptProps.getProperty('CLOUDFLARE_AUTH_TOKEN');

// Extract the Cloudflare AI Gateway Token used for securely routing requests through CF Gateway.
const CF_AIG_TOKEN = scriptProps.getProperty('CLOUDFLARE_AI_GATEWAY_TOKEN');

// Extract the Cloudflare AI Gateway Slugname 
const CF_AIG_SLUG = scriptProps.getProperty('CLOUDFLARE_AI_GATEWAY_SLUG') || 'default-gateway';

// Extract the Cloudflare Browser Render API Token used for scraping recipe website content to markdown and to extract the prepared dish photo.
const CF_BROWSER_RENDER_TOKEN = scriptProps.getProperty('CLOUDFLARE_BROWSER_RENDER_TOKEN');

// Extract the Cloudflare Images API Token used for hosting recipe prepared dish photos.
const CF_IMAGES_API_TOKEN = scriptProps.getProperty('CLOUDFLARE_IMAGES_STREAM_TOKEN');

// Retrieve the Google Custom Search API Key for web scraping capabilities.
const SEARCH_API_KEY = scriptProps.getProperty('SEARCH_API_KEY');

// Retrieve the Custom Search Engine ID (CX) required for Google Search targeting.
const SEARCH_CX = scriptProps.getProperty('SEARCH_CX');

// Define the core application configuration, locking down structural IDs and API endpoints.
const CONFIG = {
  // Google Drive template ID for the recipe document.
  TEMPLATE_ID: scriptProps.getProperty('TEMPLATE_ID'),
  // Target Google Drive folder ID where newly generated recipes will be stored.
  FOLDER_ID: scriptProps.getProperty('FOLDER_ID'),
  // Google Sheet ID used for system logging, auditing, and analytics.
  LOG_SHEET_ID: scriptProps.getProperty('LOG_SHEET_ID'),

  // Inject the retrieved Search API Key into the active configuration.
  SEARCH_API_KEY: SEARCH_API_KEY,
  // Inject the retrieved Search CX into the active configuration.
  SEARCH_CX: SEARCH_CX,

  // Map the Account ID to the internal key representation.
  CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID,
  // Dynamically construct the Cloudflare AI Gateway Universal Endpoint utilizing the account ID.
  CLOUDFLARE_AI_GATEWAY_URL: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_AIG_SLUG}/compat/chat/completions`,
  // Map the AIG Token to the internal key representation.
  CLOUDFLARE_AI_GATEWAY_KEY: CF_AIG_TOKEN,
  // Map the Auth Token to the internal key representation.
  CLOUDFLARE_AUTH_TOKEN: CF_AUTH_TOKEN,
  // Map the Browser Render API Token to the internal key representation.
  CLOUDFLARE_BROWSER_RENDER_TOKEN: CF_BROWSER_RENDER_TOKEN,
  // Map the Images API Token to the internal key representation.
  CLOUDFLARE_IMAGES_STREAM_TOKEN: CF_BROWSER_RENDER_TOKEN,

  // Define the designated Agent LLM. Using the OpenAI interface structure for guaranteed tool calling compliance.
  AI_MODEL: scriptProps.getProperty('AI_MODEL_NAME') || 'google-ai-studio/gemini-2.5-pro',
  AI_MODEL_FALLBACK_NAME: scriptProps.getProperty('AI_MODEL_FALLBACK_NAME') || 'workers-ai/@cf/openai/gpt-oss-120b',

  // Define the target worksheet name within the logging spreadsheet.
  HISTORY_SHEET_NAME: 'History'
};
