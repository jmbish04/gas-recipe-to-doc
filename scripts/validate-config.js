/**
 * @fileoverview Static Configuration Validator for Google Apps Script
 * @description Scans the src/ directory for references to the CONFIG object and 
 * verifies they exist within src/config/environment.js. 
 * Prevents runtime 'undefined' errors during execution.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '../src');
const CONFIG_PATH = path.join(SRC_DIR, 'config/environment.js');
const SUPPORTED_EXTENSIONS = ['.js', '.gs', '.html'];

/**
 * Extracts valid keys from the CONFIG object in environment.js
 * @returns {Set<string>} A set of valid configuration keys.
 */
function getValidConfigKeys() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ CRITICAL: Configuration file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  
  // Extract the object block for CONFIG
  const configMatch = content.match(/const CONFIG = \{([\s\S]*?)\};/);
  if (!configMatch) {
    console.error('❌ CRITICAL: Could not find CONFIG object definition in environment.js');
    process.exit(1);
  }

  const configBlock = configMatch[1];
  const keyRegex = /^\s+([A-Z0-9_]+):/gm;
  const keys = new Set();
  let match;

  while ((match = keyRegex.exec(configBlock)) !== null) {
    keys.add(match[1]);
  }

  console.log(`✅ Loaded ${keys.size} valid keys from environment.js`);
  return keys;
}

/**
 * Recursively scans files and checks for CONFIG.KEY usage
 */
function validateDirectory(dir, validKeys, errors) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip archive directory if it exists
      if (file !== 'archive') {
        validateDirectory(fullPath, validKeys, errors);
      }
    } else if (SUPPORTED_EXTENSIONS.includes(path.extname(file))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const usageRegex = /CONFIG\.([A-Z0-9_]+)/g;
      let match;

      while ((match = usageRegex.exec(content)) !== null) {
        const usedKey = match[1];
        if (!validKeys.has(usedKey)) {
          const lines = content.substring(0, match.index).split('\n');
          errors.push({
            file: path.relative(SRC_DIR, fullPath),
            key: usedKey,
            line: lines.length
          });
        }
      }
    }
  });
}

function runValidation() {
  console.log('🔍 Starting CONFIG validation check...');
  
  const validKeys = getValidConfigKeys();
  const errors = [];

  validateDirectory(SRC_DIR, validKeys, errors);

  if (errors.length > 0) {
    console.error('\n❌ VALIDATION FAILED: Invalid CONFIG references found:');
    errors.forEach(err => {
      console.error(`   - [${err.file}:${err.line}] Undefined key: CONFIG.${err.key}`);
    });
    console.error(`\nTotal errors: ${errors.length}. Please define these keys in src/config/environment.js.\n`);
    process.exit(1);
  } else {
    console.log('✨ Validation successful! All CONFIG references are valid.\n');
  }
}

runValidation();
