/**
 * @fileoverview Deployment Flattener for Clasp with Dependency Ordering
 * @description Recursively flattens the src/ directory into dist/ for deployment.
 * Implements numeric prefixing to enforce Google Apps Script execution order 
 * and updates .clasp.json with the generated file sequence.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');
const CLASP_CONFIG_PATH = path.join(__dirname, '../.clasp.json');

// Supported Apps Script extensions
const SUPPORTED_EXTENSIONS = ['.js', '.gs', '.html', '.json'];

/**
 * Define Rank Tiers for ordering (lower numbers load first in GAS compiler)
 * - Tiers are assigned based on relative path markers.
 * - Exact matches take precedence.
 */
const TIER_MAP = {
  'config/environment.js': 0,    // Global CONFIG initialization
  'config/': 10,                 // Configuration helpers
  'utils/shared.js': 20,         // Base utilities (_redactUrl, etc)
  'utils/': 30,                  // Logging and secondary utils
  'services/agentConfig.js': 40, // AI Schemas and System Prompts
  'services/': 50,               // Service logic and integrations
  'api/': 60,                    // Handlers and HTTP entry points
  'manifest': -1                 // appsscript.json must be root-level
};

/**
 * Determines the execution tier for a file based on its relative path.
 */
function getFileTier(relativeTrace) {
  if (TIER_MAP[relativeTrace] !== undefined) return TIER_MAP[relativeTrace];
  
  for (const key in TIER_MAP) {
    if (key.endsWith('/') && relativeTrace.startsWith(key)) {
      return TIER_MAP[key];
    }
  }
  return 100; // Default rank for miscellaneous files
}

function flatten() {
  console.log('🏗️  Starting build: Flattening src/ to dist/ with Order Optimization...');

  // 1. Clean and recreate dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR);

  const rawFiles = [];

  // 2. Recursive walker to find all files in src/
  function walk(currentPath) {
    const list = fs.readdirSync(currentPath);
    list.forEach(item => {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        if (SUPPORTED_EXTENSIONS.includes(path.extname(item))) {
          rawFiles.push(fullPath);
        }
      }
    });
  }

  walk(SRC_DIR);

  // 3. Map files to tiers and normalize paths
  const processedFiles = rawFiles.map(filePath => {
    const relPath = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
    const isManifest = relPath === 'appsscript.json';
    const tier = isManifest ? -1 : getFileTier(relPath);
    
    return {
      fullPath: filePath,
      relPath: relPath,
      tier: tier
    };
  });

  // 4. Sort files: Tier (Primary) -> Alphabetical RelPath (Secondary)
  processedFiles.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.relPath.localeCompare(b.relPath);
  });

  // 5. Copy files with numeric prefixing to enforce alphabetical loading in GAS
  const finalFileOrder = [];
  const copiedFiles = new Set();

  processedFiles.forEach((file, index) => {
    let destName;
    if (file.relPath === 'appsscript.json') {
      destName = 'appsscript.json';
    } else {
      // Flatten path into filename (e.g. config/environment.js -> config_environment.js)
      const pathId = file.relPath.replace(/\//g, '_');
      // Format index with leading zeros (e.g. 000, 001...) to ensure alphabetical correctness
      const prefix = index.toString().padStart(3, '0');
      destName = `${prefix}_${pathId}`;
    }

    const destPath = path.join(DIST_DIR, destName);

    if (copiedFiles.has(destName)) {
      console.error(`❌ COLLISION DETECTED: Final name "${destName}" generated twice.`);
      process.exit(1);
    }

    fs.copyFileSync(file.fullPath, destPath);
    copiedFiles.add(destName);
    finalFileOrder.push(destName);
    console.log(`   ✅ Ordered: [Tier ${file.tier.toString().padStart(3, ' ')}] ${file.relPath} -> ${destName}`);
  });

  // 6. Programmatically update .clasp.json with the generated fileOrder
  if (fs.existsSync(CLASP_CONFIG_PATH)) {
    try {
      const claspConfig = JSON.parse(fs.readFileSync(CLASP_CONFIG_PATH, 'utf8'));
      claspConfig.fileOrder = finalFileOrder;
      fs.writeFileSync(CLASP_CONFIG_PATH, JSON.stringify(claspConfig, null, 2), 'utf8');
      console.log(`📝 Updated .clasp.json with fileOrder (${finalFileOrder.length} files).`);
    } catch (e) {
      console.warn(`⚠️  Failed to update .clasp.json: ${e.message}`);
    }
  }

  console.log(`🚀 Build complete. ${copiedFiles.size} files ready in dist/`);
}

flatten();
