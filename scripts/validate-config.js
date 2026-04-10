/**
 * @fileoverview Static CONFIG Validator for Google Apps Script
 * @description Scans src/ for CONFIG.KEY patterns and verifies them against definitions in environment.js.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '../src');
const CONFIG_PATH = path.join(SRC_DIR, 'config/environment.js');
const SUPPORTED_EXTENSIONS = ['.js', '.gs', '.html'];

function getValidConfigKeys() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ CRITICAL: Configuration file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  // Regex to find keys in the CONFIG object: KEY: value
  const configMatch = content.match(/(?:const|let) CONFIG = \{([\s\S]*?)\};/);
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

function validateDirectory(dir, validKeys, errors) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file !== 'archive' && file !== 'node_modules') {
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
  console.log('🔍 Starting CONFIG integrity check...');
  const validKeys = getValidConfigKeys();
  const errors = [];

  validateDirectory(SRC_DIR, validKeys, errors);

  if (errors.length > 0) {
    console.error('\n❌ VALIDATION FAILED: Invalid CONFIG references found:');
    errors.forEach(err => {
      console.error(`   - [${err.file}:${err.line}] Undefined key: CONFIG.${err.key}`);
    });
    process.exit(1);
  } else {
    console.log('✨ Validation successful! All configuration references are valid.\n');
  }
}

runValidation();
