# Google Apps Script Standards

- Always use `PropertiesService.getScriptProperties()` for sensitive API tokens.
- Wrap all `UrlFetchApp` calls in `try/catch` blocks to prevent script termination on network failures.
- Document manipulation must end with `doc.saveAndClose()` to flush changes to Google Drive immediately.
- Use `toUpperCase()` for document headers to maintain the "Senior Engineer" design aesthetic.
