const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listDatabases } = require('./list-db');

/**
 * Get property column info, including only keys present in the datatype
 * @param {string} propName - Property name
 * @param {Object} propSchema - Property schema from Notion
 * @returns {Object} Column info with name, type, and values (if applicable)
 */
function getColumnInfo(propName, propSchema) {
  const column = {
    name: propName,
    type: propSchema.type,
  };

  // Add type-specific fields that exist
  switch (propSchema.type) {
    case 'select':
      if (propSchema.select && propSchema.select.options) {
        column.values = propSchema.select.options.map(opt => ({
          name: opt.name,
          color: opt.color,
          ...(opt.id && { id: opt.id }),
        }));
      }
      break;

    case 'multi_select':
      if (propSchema.multi_select && propSchema.multi_select.options) {
        column.values = propSchema.multi_select.options.map(opt => ({
          name: opt.name,
          color: opt.color,
          ...(opt.id && { id: opt.id }),
        }));
      }
      break;

    case 'status':
      if (propSchema.status && propSchema.status.options) {
        column.values = propSchema.status.options.map(opt => ({
          name: opt.name,
          color: opt.color,
          ...(opt.id && { id: opt.id }),
        }));
        if (propSchema.status.groups) {
          column.groups = propSchema.status.groups;
        }
      }
      break;

    case 'number':
      if (propSchema.number && propSchema.number.format) {
        column.format = propSchema.number.format;
      }
      break;

    case 'formula':
      if (propSchema.formula && propSchema.formula.expression) {
        column.expression = propSchema.formula.expression;
      }
      break;

    case 'relation':
      if (propSchema.relation) {
        column.database_id = propSchema.relation.database_id;
        if (propSchema.relation.synced_property_name) {
          column.synced_property_name = propSchema.relation.synced_property_name;
        }
        if (propSchema.relation.synced_property_id) {
          column.synced_property_id = propSchema.relation.synced_property_id;
        }
      }
      break;

    case 'rollup':
      if (propSchema.rollup) {
        if (propSchema.rollup.relation_property_name) {
          column.relation_property_name = propSchema.rollup.relation_property_name;
        }
        if (propSchema.rollup.relation_property_id) {
          column.relation_property_id = propSchema.rollup.relation_property_id;
        }
        if (propSchema.rollup.rollup_property_name) {
          column.rollup_property_name = propSchema.rollup.rollup_property_name;
        }
        if (propSchema.rollup.rollup_property_id) {
          column.rollup_property_id = propSchema.rollup.rollup_property_id;
        }
        if (propSchema.rollup.function) {
          column.function = propSchema.rollup.function;
        }
      }
      break;
  }

  return column;
}

/**
 * Sync database metadata from Notion
 * @param {Object} params
 * @param {Client} params.client - Notion API client
 * @param {number} params.limit - Maximum number of databases to sync (default: all)
 * @returns {Promise<Array>} Array of database metadata
 */
async function syncDatabaseMetadata({ client, limit }) {
  // Get all databases
  const databases = await listDatabases({ client, limit });

  // Fetch detailed metadata for each database
  const metadata = [];
  for (const db of databases) {
    try {
      // Fetch full database details
      const dbDetails = await client.databases.retrieve({ database_id: db.id });

      const dbMetadata = {
        id: db.id,
        title: db.title,
        url: db.url,
        columns: [],
      };

      // Extract property information
      for (const [propName, propSchema] of Object.entries(dbDetails.properties || {})) {
        const column = getColumnInfo(propName, propSchema);
        dbMetadata.columns.push(column);
      }

      metadata.push(dbMetadata);
    } catch (err) {
      console.error(`Error fetching metadata for database ${db.id} (${db.title}):`, err.message);
      // Continue with other databases
    }
  }

  return metadata;
}

/**
 * Get cache file path based on environment
 * @param {string} env - Environment ('production' or 'test')
 * @returns {string} Cache file path
 */
function getCacheFilePath(env) {
  const homeDir = os.homedir();
  return path.join(homeDir, `.notion-cache.${env}.json`);
}

module.exports = {
  command: 'sync-meta',
  describe: 'Sync database metadata from Notion and cache it locally',

  builder: (yargs) => {
    return yargs
      .option('limit', {
        type: 'number',
        describe: 'Maximum number of databases to sync',
      })
      .option('env', {
        type: 'string',
        describe: 'Environment (determines cache file)',
        choices: ['production', 'test'],
        default: process.env.NODE_ENV === 'test' ? 'test' : 'production',
      })
      .example('$0 sync-meta')
      .example('$0 sync-meta --env test')
      .example('$0 sync-meta --limit 10');
  },

  handler: async (argv) => {
    try {
      const { limit, env } = argv;

      // Get NOTION_TOKEN from environment
      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      // Create Notion client
      const client = new Client({ auth: token });

      console.log(`Syncing database metadata (env: ${env})...`);

      // Sync metadata
      const metadata = await syncDatabaseMetadata({ client, limit });

      // Get cache file path
      const cacheFilePath = getCacheFilePath(env);

      // Write to cache file
      fs.writeFileSync(cacheFilePath, JSON.stringify(metadata, null, 2), 'utf8');

      console.log(`\n✓ Synced ${metadata.length} database(s)`);
      console.log(`✓ Cache saved to: ${cacheFilePath}`);

      process.exit(0);
    } catch (err) {
      if (err && err.body) {
        console.error('Notion API Error:', JSON.stringify(err.body, null, 2));
      } else {
        console.error('Error:', err.message || String(err));
      }
      process.exit(1);
    }
  },

  // Export functions for testing
  syncDatabaseMetadata,
  getCacheFilePath,
  getColumnInfo,
};
