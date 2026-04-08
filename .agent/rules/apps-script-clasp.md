# Clasp Architecture Standards

-   **Module Resolution:** When building in `src/` for Google Apps Script using `clasp`, do not use ES6 `import`/`export` syntax unless compiling via Webpack. Rely on global scope variables and functions spread across files.
-   **File Concatenation:** Ensure naming conventions are strictly unique across all files, as `clasp` flattens the `src/` directory during deployment.
-   **Documentation:** Utilize standard JSDoc `/** @fileoverview */` at the top of every file to dictate the module's architectural responsibility before its logic executes.
