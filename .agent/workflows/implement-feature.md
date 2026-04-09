# Workflow: Fixing Generative UI Stall

## Phase 1: Behavior Correction
- [ ] Update `SYSTEM_PROMPT` to mandate immediate tool usage for recipe suggestions.
- [ ] Modify `executeAgentLoop` to intercept proposal tool calls and inject image URLs using `findRecipeImage`.

## Phase 2: Data Persistence
- [ ] Verify `_logToSheet_` uses the hardcoded ID: `15OZdqdenNGVASN_EjygVuQkpL6ldO_Lk-hDon7aszw4`.
- [ ] Ensure `createRecipeDoc` targets Folder ID: `1E0Mw2uZovNIJxFJ76chDzbrNyGef8jKJ`.

## Phase 3: Frontend Hydration
- [ ] Update React `MessageBubble` to map over tool output and render `RecipeCard`.
- [ ] Connect `RecipeCard` export button to `google.script.run.createRecipeDoc`.
