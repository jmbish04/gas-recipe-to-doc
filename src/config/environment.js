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
const CF_WRANGLER_API_TOKEN = scriptProps.getProperty('CLOUDFLARE_WRANGLER_API_TOKEN');

// Extract the Cloudflare AI Gateway Token used for securely routing requests through CF Gateway.
const CF_AIG_TOKEN = scriptProps.getProperty('CLOUDFLARE_AI_GATEWAY_TOKEN');

// Extract the Cloudflare AI Gateway Slugname 
const CF_AIG_SLUG = scriptProps.getProperty('CLOUDFLARE_AI_GATEWAY_SLUG') || 'default-gateway';

// Dynamically construct the Cloudflare AI Gateway BaseUrl utilizing the account ID and AIG Slug.
const CLOUDFLARE_AI_GATEWAY_BASE_URL = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_AIG_SLUG}`

// Extract the Cloudflare Browser Render API Token used for scraping recipe website content to markdown and to extract the prepared dish photo.
const CF_BROWSER_RENDER_TOKEN = scriptProps.getProperty('CLOUDFLARE_BROWSER_RENDER_TOKEN');

// Extract the Cloudflare Images API Token used for hosting recipe prepared dish photos.
const CF_IMAGES_API_TOKEN = scriptProps.getProperty('CLOUDFLARE_IMAGES_STREAM_TOKEN');

// Retrieve the Google Custom Search API Key for web scraping capabilities.
const SEARCH_API_KEY = scriptProps.getProperty('SEARCH_API_KEY');

// Retrieve the Custom Search Engine ID (CX) required for Google Search targeting.
const SEARCH_CX = scriptProps.getProperty('SEARCH_CX');


// Define the core application configuration, locking down structural IDs and API endpoints.
let CONFIG = {
  // Session tracking to be initialized by client
  SESSION_ID: null,
  SESSION_FOLDER_ID: null,
  SESSION_FOLDER_URL: null,
  // Google Drive template ID for the recipe document.
  TEMPLATE_ID: scriptProps.getProperty('TEMPLATE_ID'),
  // Target Google Drive folder ID where newly generated recipes will be stored.
  FOLDER_ID: scriptProps.getProperty('FOLDER_ID'),
  // Target Google Drive folder ID where SESSION folders will be created for storing images, etc.
  SESSION_PARENT_FOLDER_ID: scriptProps.getProperty('SESSION_PARENT_FOLDER_ID'),
  // Google Sheet ID used for system logging, auditing, and analytics.
  LOG_SHEET_ID: scriptProps.getProperty('LOG_SHEET_ID'),


  // Inject the retrieved Search API Key into the active configuration.
  SEARCH_API_KEY: SEARCH_API_KEY,
  // Inject the retrieved Search CX into the active configuration.
  SEARCH_CX: SEARCH_CX,

  // Map the Account ID to the internal key representation.
  CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID,
  // Dynamically construct the Cloudflare AI Gateway BaseUrl utilizing the account ID and AIG Slug.
  CLOUDFLARE_AI_GATEWAY_BASE_URL: CLOUDFLARE_AI_GATEWAY_BASE_URL,
  // Dynamically construct the Cloudflare AI Gateway Universal Endpoint utilizing the baseUrl above.
  CLOUDFLARE_AI_GATEWAY_COMPAT_URL: `${CLOUDFLARE_AI_GATEWAY_BASE_URL}/compat/chat/completions`,
  // Dynamically construct the Cloudflare AI Gateway workers-ai image Endpoint utilizing the baseUrl above.
  CLOUDFLARE_AI_GATEWAY_WORKERS_AI_IMAGE_URL: `${CLOUDFLARE_AI_GATEWAY_BASE_URL}/workers-ai`,
  // Dynamically construct the Cloudflare Workers AI Endpoint untilzing the account ID.
  CLOUDFLARE_WORKERS_AI_URL: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`, // @cf/openai/gpt-oss-120b
  // Dynamically construct the Cloudflare Browser Render Endpoint untilzing the account ID.
  CLOUDFLARE_BROWSER_RENDER_URL: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering`, // /markdown, /scrape, /screenshot, /PDF, /json
  // Dynamically construct the Cloudflare Images Endpoint untilzing the account ID.
  CLOUDFLARE_IMAGES_URL: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1`,
  // Map the AIG Token to the internal key representation.
  CLOUDFLARE_AI_GATEWAY_TOKEN: CF_AIG_TOKEN,
  // Map the Auth Token to the internal key representation.
  CLOUDFLARE_WRANGLER_API_TOKEN: CF_WRANGLER_API_TOKEN,
  // Map the Browser Render API Token to the internal key representation.
  CLOUDFLARE_BROWSER_RENDER_TOKEN: CF_BROWSER_RENDER_TOKEN,
  // Map the Images API Token to the internal key representation.
  CLOUDFLARE_IMAGES_STREAM_TOKEN: CF_BROWSER_RENDER_TOKEN,

  // Define the designated Agent LLM. Using the OpenAI interface structure for guaranteed tool calling compliance.
  AI_MODEL: scriptProps.getProperty('AI_MODEL_NAME') || 'google-ai-studio/gemini-3-flash-preview',
  AI_MODEL_FALLBACK_NAME: scriptProps.getProperty('AI_MODEL_FALLBACK_NAME') || 'workers-ai/@cf/moonshotai/kimi-k2.5',
  AI_MODEL_IMAGE_CREATOR: scriptProps.getProperty('AI_MODEL_IMAGE_CREATOR') || 'workers-ai/@cf/black-forest-labs/flux-2-dev',

  // Define the target worksheet names within the logging spreadsheet.
  HISTORY_SHEET_NAME: 'History',
  TELEMETRY_SHEET_NAME: 'Telemetry'
};
