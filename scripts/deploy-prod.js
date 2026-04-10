/**
 * @fileoverview Programmatic Production Deployer
 * @module scripts/deploy-prod
 * @description Orchestrates the final deployment to Google Apps Script.
 * Ensures the build is flattened, pushed, and the 'PROD_WEB_APP' deployment is updated.
 */

const { execSync } = require('child_process');

/**
 * Executes a shell command and returns the output string.
 */
function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }).trim();
  } catch (e) {
    console.error(`❌ Execution failed: ${command}`);
    process.exit(1);
  }
}

function deploy() {
  const startTime = Date.now();
  console.log('🚀 Starting Production Deployment...');

  // 1. Sync local changes to Apps Script (includes build flattener)
  console.log('📦 Syncing files with clasp push...');
  run('npm run push');

  // 2. Resolve the Production Deployment ID
  console.log('🔍 Locating PROD_WEB_APP deployment...');
  const deploymentsOutput = run('npx clasp deployments');
  
  // Parse for the specific production tag
  const prodLine = deploymentsOutput.split('\n').find(line => line.includes('PROD_WEB_APP'));

  if (!prodLine) {
    console.error('\n❌ ERROR: No deployment with description "PROD_WEB_APP" found.');
    console.error('Check your deployments with: npx clasp deployments');
    process.exit(1);
  }

  // Extract ID (usually the second item in the list: "- [ID] @[Version] - [Description]")
  const deployId = prodLine.split(/\s+/)[1];
  
  if (!deployId) {
    console.error('❌ ERROR: Could not parse Deployment ID from line:', prodLine);
    process.exit(1);
  }

  console.log(`✅ Found Production Deployment: ${deployId}`);

  // 3. Execute the update
  console.log('⚡ Updating deployment version...');
  run(`npx clasp deploy -i ${deployId} -d "PROD_WEB_APP"`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n-------------------------------------------------------------------');
  console.log('🎉 DEPLOYMENT SUCCESSFUL');
  console.log(`🆔 Deployment Id: ${deployId}`);
  console.log(`🔗 URL: https://script.google.com/macros/s/${deployId}/exec`);
  console.log(`⏱️  Time: ${elapsed}s`);
  console.log('-------------------------------------------------------------------\n');
}

deploy();
