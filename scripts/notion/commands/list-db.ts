const { Client } = require('@notionhq/client');

/**
 * List all databases accessible to the integration
 * @param {Object} params
 * @param {Client} params.client - Notion API client
 * @param {number} params.limit - Maximum number of databases to return (default: 100)
 * @returns {Promise<Array>} Array of {id, title, url} objects
 */
async function listDatabases({ client, limit = 100 }) {
  const databases = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore && databases.length < limit) {
    const response = await client.search({
      filter: {
        value: 'database',
        property: 'object',
      },
      page_size: Math.min(100, limit - databases.length),
      start_cursor: startCursor,
    });

    for (const db of response.results) {
      const title = db.title?.map(t => t.plain_text).join('') || 'Untitled';
      databases.push({
        id: db.id,
        title,
        url: db.url,
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return databases;
}

module.exports = {
  command: 'list-db',
  describe: 'List all databases accessible to the integration',

  builder: (yargs) => {
    return yargs
      .option('limit', {
        type: 'number',
        describe: 'Maximum number of databases to return',
        default: 100,
      })
      .option('format', {
        type: 'string',
        describe: 'Output format',
        choices: ['json', 'table'],
        default: 'json',
      })
      .example('$0 list-db')
      .example('$0 list-db --limit 10')
      .example('$0 list-db --format table');
  },

  handler: async (argv) => {
    try {
      const { limit, format } = argv;

      // Get NOTION_TOKEN from environment
      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      // Create Notion client
      const client = new Client({ auth: token });

      // List databases
      const databases = await listDatabases({ client, limit });

      // Output results
      if (format === 'table') {
        // Print as table
        console.log('\nDatabases:\n');
        databases.forEach((db, index) => {
          console.log(`${index + 1}. ${db.title}`);
          console.log(`   ID:  ${db.id}`);
          console.log(`   URL: ${db.url}`);
          console.log('');
        });
        console.log(`Total: ${databases.length} database(s)`);
      } else {
        // Print as JSON
        console.log(JSON.stringify(databases, null, 2));
      }

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

  // Export the core function for testing
  listDatabases,
};
