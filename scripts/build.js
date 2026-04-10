/**
 * @fileoverview Deployment Flattener for Clasp
 * @description Recursively flattens the src/ directory into dist/ for deployment.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');

// Supported Apps Script extensions
const SUPPORTED_EXTENSIONS = ['.js', '.gs', '.html', '.json'];

function flatten() {
  console.log('🏗️  Starting build: Flattening src/ to dist/...');

  // 1. Clean and recreate dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR);

  const filesToCopy = [];

  // 2. Recursive walker to find all files
  function walk(currentPath) {
    const list = fs.readdirSync(currentPath);
    list.forEach(item => {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        if (SUPPORTED_EXTENSIONS.includes(path.extname(item))) {
          filesToCopy.push(fullPath);
        }
      }
    });
  }

  walk(SRC_DIR);

  // 3. Copy and flatten with collision detection
  const copiedFiles = new Set();

  filesToCopy.forEach(filePath => {
    const fileName = path.basename(filePath);
    const destPath = path.join(DIST_DIR, fileName);

    if (copiedFiles.has(fileName)) {
      console.error(`❌ COLLISION DETECTED: File "${fileName}" exists in multiple directories.`);
      console.error(`   Attempted to copy: ${filePath}`);
      process.exit(1);
    }

    fs.copyFileSync(filePath, destPath);
    copiedFiles.add(fileName);
    console.log(`   ✅ Flattened: ${path.relative(SRC_DIR, filePath)} -> ${fileName}`);
  });

  console.log(`🚀 Build complete. ${copiedFiles.size} files ready in dist/`);
}

flatten();
