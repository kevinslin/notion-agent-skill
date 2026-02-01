#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { loadEnv } = require('./utils');

// Load environment variables from kevin-garden/.env
try {
  loadEnv();
} catch (err) {
  // If loadEnv fails, try dotenv for .env in current directory or environment
  try {
    require('dotenv').config();
  } catch (dotenvErr) {
    // Ignore, will fail later if NOTION_TOKEN is not set
  }
}

// Import commands
const createCommand = require('./commands/create');
const listDbCommand = require('./commands/list-db');
const syncMetaCommand = require('./commands/sync-meta');
const syncCommand = require('./commands/sync');
const parseBlockCommand = require('./commands/parse-block');
const statusCommand = require('./commands/status');

// Build CLI
yargs(hideBin(process.argv))
  .command(createCommand)
  .command(listDbCommand)
  .command(syncMetaCommand)
  .command(syncCommand)
  .command(parseBlockCommand)
  .command(statusCommand)
  .demandCommand(1, 'You must specify a command')
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .strict()
  .parse();
