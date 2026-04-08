/**
 * @fileoverview Environment & Configuration Module
 * @module config/environment
 * @description Centralized configuration registry managing external integrations, API keys, and service routing.
 * Implements a self-healing fallback pattern by safely defaulting missing properties where appropriate.
 */

// Initialize the PropertiesService to retrieve environment variables from Google Apps Script.
const scriptProps = PropertiesService.getScriptProperties();

// Safely extract the Cloudflare Account ID or fallback to a placeholder to prevent immediate catastrophic failure.
const CF_ACCOUNT_ID = scriptProps.getProperty('CLOUDFLARE_ACCOUNT_ID') || 'YOUR_ACCOUNT_ID';

// Extract the Cloudflare AI Gateway Token used for securely routing requests through CF Gateway.
const CF_AIG_TOKEN = scriptProps.getProperty('CF_AIG_TOKEN') || 'YOUR_CF_AIG_TOKEN';

// Retrieve the Google Custom Search API Key for web scraping capabilities.
const SEARCH_API_KEY = scriptProps.getProperty('SEARCH_API_KEY') || 'YOUR_SEARCH_API_KEY';

// Retrieve the Custom Search Engine ID (CX) required for Google Search targeting.
const SEARCH_CX = scriptProps.getProperty('SEARCH_CX') || 'YOUR_SEARCH_CX';

// Define the core application configuration, locking down structural IDs and API endpoints.
const CONFIG = {
  // Google Drive template ID for the recipe document.
  TEMPLATE_ID: scriptProps.getProperty('TEMPLATE_ID') || '13LXhg3sBiPHcOhLM25wJuIREK1MzIReNu4BwrEXGdPU',
  // Target Google Drive folder ID where newly generated recipes will be stored.
  FOLDER_ID: scriptProps.getProperty('FOLDER_ID') || '1E0Mw2uZovNIJxFJ76chDzbrNyGef8jKJ',
  // Google Sheet ID used for system logging, auditing, and analytics.
  LOG_SHEET_ID: scriptProps.getProperty('LOG_SHEET_ID') || '15OZdqdenNGVASN_EjygVuQkpL6ldO_Lk-hDon7aszw4',

  // Inject the retrieved Search API Key into the active configuration.
  SEARCH_API_KEY: SEARCH_API_KEY,
  // Inject the retrieved Search CX into the active configuration.
  SEARCH_CX: SEARCH_CX,

  // Dynamically construct the Cloudflare AI Gateway Universal Endpoint utilizing the account ID.
  CLOUDFLARE_AI_GATEWAY_URL: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/default-gateway/compat/chat/completions`,
  // Map the AIG Token to the internal key representation.
  CLOUDFLARE_AI_GATEWAY_KEY: CF_AIG_TOKEN,

  // Define the designated Agent LLM. Using the OpenAI interface structure for guaranteed tool calling compliance.
  AI_MODEL: 'openai/gpt-4o-mini',

  // Define the target worksheet name within the logging spreadsheet.
  HISTORY_SHEET_NAME: 'History'
};
