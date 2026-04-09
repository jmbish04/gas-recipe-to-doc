# Proactive Agent Standards
- **Pipeline Integrity:** Never bypass the orchestrator function (`enrichRecipesWithImages`) for raw results. The orchestrator is required for scraping and persistent Cloudflare delivery.
- **Visual Visibility:** Every recipe card must render a hero image `<img>` with an `onError` handler to prevent UI breakage.
