#!/usr/bin/env node

/**
 * Setup Test Database
 *
 * This script ensures the test database has all required properties for integration tests.
 * It will add any missing properties without modifying existing ones.
 *
 * Usage:
 *   node integ/setupTestDatabase.js
 *
 * Prerequisites:
 *   - NOTION_TOKEN in .env.test
 *   - TEST_DATABASE_ID in .env.test
 */

const { Client } = require('@notionhq/client');

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';

// Load environment variables
const { loadEnv } = require('../utils');
try {
  loadEnv();
} catch (err) {
  console.error('Error loading .env.test:', err.message);
  process.exit(1);
}

// Required properties for tests
const REQUIRED_PROPERTIES = {
  Name: {
    type: 'title',
    title: {},
  },
  Status: {
    type: 'status',
    status: {
      options: [
        { name: 'Not started', color: 'default' },
        { name: 'In progress', color: 'blue' },
        { name: 'Done', color: 'green' },
      ],
      groups: [
        {
          id: 'not-started-group',
          name: 'To-do',
          color: 'gray',
          option_ids: [],
        },
        {
          id: 'in-progress-group',
          name: 'In progress',
          color: 'blue',
          option_ids: [],
        },
        {
          id: 'complete-group',
          name: 'Complete',
          color: 'green',
          option_ids: [],
        },
      ],
    },
  },
  Priority: {
    type: 'number',
    number: {
      format: 'number',
    },
  },
  Done: {
    type: 'checkbox',
    checkbox: {},
  },
  Tags: {
    type: 'multi_select',
    multi_select: {
      options: [
        { name: 'urgent', color: 'red' },
        { name: 'important', color: 'orange' },
        { name: 'test', color: 'blue' },
      ],
    },
  },
  Category: {
    type: 'select',
    select: {
      options: [
        { name: 'Work', color: 'blue' },
        { name: 'Personal', color: 'green' },
        { name: 'Other', color: 'gray' },
      ],
    },
  },
  Date: {
    type: 'date',
    date: {},
  },
  Description: {
    type: 'rich_text',
    rich_text: {},
  },
  dendron_id: {
    type: 'rich_text',
    rich_text: {},
  },
  last_synced: {
    type: 'date',
    date: {},
  },
};

async function setupTestDatabase() {
  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!token) {
    console.error('ERROR: NOTION_TOKEN not found in .env.test');
    console.error('Please set NOTION_TOKEN in kevin-garden/.env.test');
    process.exit(1);
  }

  const databaseId = process.env.TEST_DATABASE_ID;
  if (!databaseId) {
    console.error('ERROR: TEST_DATABASE_ID not found in .env.test');
    console.error('Please set TEST_DATABASE_ID in .env.test');
    console.error('\nTo create a test database:');
    console.error('1. Go to notion.so');
    console.error('2. Create a new database (table view)');
    console.error('3. Share it with your integration');
    console.error('4. Copy the database ID from the URL');
    console.error('5. Add TEST_DATABASE_ID=<id> to .env.test');
    process.exit(1);
  }

  const client = new Client({ auth: token });

  console.log('Fetching test database...');
  let database;
  try {
    database = await client.databases.retrieve({ database_id: databaseId });
  } catch (err) {
    if (err.code === 'object_not_found') {
      console.error('\nERROR: Could not find database with ID:', databaseId);
      console.error('\nPossible issues:');
      console.error('1. The database ID is incorrect');
      console.error('2. The database is not shared with your integration');
      console.error('3. The database has been deleted');
      console.error('\nTo fix:');
      console.error('1. Verify the database exists in Notion');
      console.error('2. Share it with your integration (Settings & Members > Connections)');
      console.error('3. Update TEST_DATABASE_ID in .env.test if needed');
    } else {
      console.error('\nERROR:', err.message);
    }
    process.exit(1);
  }

  console.log('✓ Found database:', database.title[0]?.plain_text || 'Untitled');
  console.log('\nCurrent properties:');

  const existingProperties = {};
  for (const [name, prop] of Object.entries(database.properties)) {
    existingProperties[name] = prop.type;
    console.log(`  - ${name} (${prop.type})`);
  }

  // Find missing properties
  const missingProperties = {};
  const propertiesNeedingUpdate = [];

  for (const [name, config] of Object.entries(REQUIRED_PROPERTIES)) {
    if (!existingProperties[name]) {
      missingProperties[name] = config;
    } else if (existingProperties[name] !== config.type) {
      propertiesNeedingUpdate.push({
        name,
        current: existingProperties[name],
        expected: config.type,
      });
    }
  }

  if (propertiesNeedingUpdate.length > 0) {
    console.log('\n⚠️  Properties with wrong types:');
    propertiesNeedingUpdate.forEach(({ name, current, expected }) => {
      console.log(`  - ${name}: currently ${current}, expected ${expected}`);
    });
    console.log('\nNote: Cannot change property types. Please manually update these properties.');
  }

  if (Object.keys(missingProperties).length === 0) {
    console.log('\n✓ All required properties exist!');
    console.log('\nTest database is ready for integration tests.');
    return;
  }

  console.log('\nMissing properties:');
  for (const [name, config] of Object.entries(missingProperties)) {
    console.log(`  - ${name} (${config.type})`);
  }

  console.log('\nAdding missing properties...');

  // Clean properties for API - remove options/groups that can't be set via update
  const cleanedProperties = {};
  for (const [name, config] of Object.entries(missingProperties)) {
    const cleanConfig = { type: config.type };

    // Add type-specific config without options/groups
    switch (config.type) {
      case 'select':
        cleanConfig.select = {};
        break;
      case 'multi_select':
        cleanConfig.multi_select = {};
        break;
      case 'status':
        cleanConfig.status = {};
        break;
      case 'number':
        cleanConfig.number = config.number || {};
        break;
      case 'title':
        cleanConfig.title = {};
        break;
      case 'rich_text':
        cleanConfig.rich_text = {};
        break;
      case 'date':
        cleanConfig.date = {};
        break;
      case 'checkbox':
        cleanConfig.checkbox = {};
        break;
      default:
        cleanConfig[config.type] = config[config.type] || {};
    }

    cleanedProperties[name] = cleanConfig;
  }

  try {
    await client.databases.update({
      database_id: databaseId,
      properties: cleanedProperties,
    });

    console.log('✓ Successfully added missing properties!');
    console.log('\n⚠️  Note: Select/multi-select/status properties were created without options.');
    console.log('Please add options manually in Notion:');

    // Show which properties need options
    const propertiesNeedingOptions = Object.keys(missingProperties).filter(name => {
      const type = missingProperties[name].type;
      return type === 'select' || type === 'multi_select' || type === 'status';
    });

    if (propertiesNeedingOptions.length > 0) {
      propertiesNeedingOptions.forEach(name => {
        const config = REQUIRED_PROPERTIES[name];
        console.log(`\n  ${name} (${config.type}):`);
        if (config.type === 'status' && config.status.options) {
          console.log('    Options:', config.status.options.map(o => o.name).join(', '));
        } else if ((config.type === 'select' || config.type === 'multi_select') && config[config.type].options) {
          console.log('    Options:', config[config.type].options.map(o => o.name).join(', '));
        }
      });
      console.log('\nTo add options:');
      console.log('1. Go to your test database in Notion');
      console.log('2. Click on each property name to edit');
      console.log('3. Add the options listed above');
    }

    console.log('\nRun tests with: npm test');
  } catch (err) {
    console.error('\nERROR: Failed to update database:', err.message);
    if (err.body) {
      console.error('Details:', JSON.stringify(err.body, null, 2));
    }
    process.exit(1);
  }
}

// Run the setup
setupTestDatabase().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
