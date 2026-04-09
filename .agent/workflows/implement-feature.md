# Workflow: Fixing Generative UI & Image Pipeline

## Phase 1: Pipeline Restoration
- [x] Refactor `executeAgentStep` in `aiGateway.js` to call `enrichRecipesWithImages`.
- [x] Verify `max_completion_tokens: 4096` is set for reasoning budget.

## Phase 2: Schema Hardening
- [x] Add detailed `description` fields to all `propose_recipes` tool parameters in `agentConfig.js`.

## Phase 3: Visual & Structural Stability
- [x] Add `<img>` rendering logic to `RecipeCard` in `index.html`.
- [x] Implement structural safety check in `googleDocs.js` list replacement logic.
