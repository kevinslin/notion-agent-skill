const { Client } = require('@notionhq/client');
const { coerceValueForPropertyType, parseBodyInput, markdownToParagraphBlocks } = require('../utils');

/**
 * Create a new Notion page in a database
 * @param {Object} params
 * @param {Client} params.client - Notion API client
 * @param {string} params.databaseId - Database ID
 * @param {Object} params.properties - Key-value pairs for properties
 * @param {string} params.body - Markdown content for page body
 * @returns {Promise<Object>} Created page object
 */
async function createPage({ client, databaseId, properties, body }) {
  // Fetch database to learn property types
  const db = await client.databases.retrieve({ database_id: databaseId });

  const propNameToType = {};
  for (const [propName, schema] of Object.entries(db.properties)) {
    propNameToType[propName] = schema.type;
  }

  // Build properties with type coercion
  const coercedProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    const type = propNameToType[key];
    if (!type) {
      throw new Error(`Property "${key}" not found in database schema. Available properties: ${Object.keys(propNameToType).join(', ')}`);
    }
    coercedProperties[key] = coerceValueForPropertyType(type, value);
  }

  // Ensure title property exists; if not provided, set blank title on first title property
  const titleEntry = Object.entries(db.properties).find(([, s]) => s.type === 'title');
  if (!titleEntry) {
    throw new Error('Database is missing a title property.');
  }
  const [titlePropName] = titleEntry;
  if (coercedProperties[titlePropName] === undefined) {
    coercedProperties[titlePropName] = coerceValueForPropertyType('title', '');
  }

  // Convert body to Notion blocks
  const children = markdownToParagraphBlocks(body || '');

  // Create the page
  const page = await client.pages.create({
    parent: { database_id: databaseId },
    properties: coercedProperties,
    children,
  });

  return page;
}

/**
 * Parse --properties flags into key-value object
 * @param {Array<string>} propertiesArray - Array of "key=value" strings
 * @returns {Object} Parsed properties object
 */
function parseProperties(propertiesArray) {
  if (!propertiesArray || propertiesArray.length === 0) {
    return {};
  }

  const properties = {};
  for (const prop of propertiesArray) {
    const firstEqualIdx = prop.indexOf('=');
    if (firstEqualIdx === -1) {
      throw new Error(`Invalid property format: "${prop}". Expected "key=value"`);
    }
    const key = prop.substring(0, firstEqualIdx).trim();
    const value = prop.substring(firstEqualIdx + 1).trim();
    if (!key) {
      throw new Error(`Property key cannot be empty in: "${prop}"`);
    }
    properties[key] = value;
  }
  return properties;
}

module.exports = {
  command: 'create',
  describe: 'Create a new Notion page',

  builder: (yargs) => {
    return yargs
      .option('database-id', {
        type: 'string',
        describe: 'Database ID where the page will be created',
        demandOption: true,
      })
      .option('properties', {
        type: 'array',
        describe: 'Page properties in key=value format (can be repeated)',
        default: [],
      })
      .option('bodyFromRawMarkdown', {
        type: 'string',
        describe: 'Raw markdown content for the page body',
      })
      .option('bodyFromTextFile', {
        type: 'string',
        describe: 'Path to a text file containing markdown for the page body',
      })
      .example('$0 create --database-id abc123 --properties Name="My Note" --properties Date=2025-12-14 --bodyFromRawMarkdown "Hello world"')
      .example('$0 create --database-id abc123 --properties Name="My Note" --bodyFromTextFile ./note.md');
  },

  handler: async (argv) => {
    try {
      const { databaseId, properties: propertiesArray, bodyFromRawMarkdown, bodyFromTextFile } = argv;

      // Validate that only one body source is provided
      if (bodyFromRawMarkdown && bodyFromTextFile) {
        throw new Error('Cannot specify both --bodyFromRawMarkdown and --bodyFromTextFile');
      }

      // Parse properties
      const properties = parseProperties(propertiesArray);

      // Determine body content
      let body = null;
      if (bodyFromRawMarkdown) {
        body = bodyFromRawMarkdown;
      } else if (bodyFromTextFile) {
        const { content } = parseBodyInput(bodyFromTextFile);
        body = content;
      }

      // Get NOTION_TOKEN from environment (should already be loaded via dotenv in main entry point)
      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      // Create Notion client
      const client = new Client({ auth: token });

      // Create the page
      const page = await createPage({
        client,
        databaseId,
        properties,
        body,
      });

      // Output result
      console.log(JSON.stringify({ id: page.id, url: page.url }, null, 2));
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
};
