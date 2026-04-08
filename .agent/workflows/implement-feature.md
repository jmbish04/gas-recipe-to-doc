# Migration to Modularized `src/` Architecture

## Objective
Refactor the monolithic Apps Script codebase into a highly modularized, file-based architecture under the `src/` directory while maintaining global scope compatibility for the `clasp` deployment tool. Ensure every logic block is fully commented with optimization logic to align with standard high-performance system requirements.

## Steps
1.  **Environment Extraction:** Isolate all static variables, dynamic PropertyService calls, and system IDs into `src/config/environment.js`.
2.  **API Handler Routing:** Move standard GAS endpoint functions (`doGet`, `doPost`) to `src/api/handlers.js`.
3.  **Agent Configuration Segregation:** Extract the static JSON schemas, prompts, and tool arrays into `src/services/agentConfig.js` to decouple logic from the execution loop.
4.  **Gateway Execution:** Port the recursive `executeAgentLoop` and `chatWithAI` functions into `src/services/aiGateway.js`.
5.  **Actuation Layer:** Isolate Google Drive/Docs templating logic into `src/services/googleDocs.js`.
6.  **External Connectivity:** Move Custom Search integrations to `src/services/googleSearch.js`.
7.  **Telemetry:** Isolate spreadsheet logging and history retrieval to `src/utils/logger.js`.
