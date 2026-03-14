const { Client } = require('@notionhq/client');

/**
 * Fetch users from the Notion API.
 * @param {Object} params
 * @param {Client} params.client - Notion API client
 * @param {number} params.limit - Maximum number of users to return (default: 1)
 * @returns {Promise<Array>} Array of user objects
 */
async function listUsers({ client, limit = 1 }) {
  const users = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore && users.length < limit) {
    const response = await client.users.list({
      page_size: Math.min(100, limit - users.length),
      start_cursor: startCursor,
    });

    if (!response || !Array.isArray(response.results)) {
      throw new Error('Notion API returned an unexpected response for users.list');
    }

    users.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return users;
}

function summarizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name || null,
    type: user.type || null,
  };
}

module.exports = {
  command: 'status',
  describe: 'Check Notion API connectivity by listing users',

  builder: (yargs) => {
    return yargs
      .option('limit', {
        type: 'number',
        describe: 'Maximum number of users to fetch',
        default: 1,
      })
      .example('$0 status')
      .example('$0 status --limit 5');
  },

  handler: async (argv) => {
    try {
      const { limit } = argv;

      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      const client = new Client({ auth: token });
      const users = await listUsers({ client, limit });

      if (!users.length) {
        throw new Error('Notion API returned zero users. Check that the integration has access to the workspace.');
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            userCount: users.length,
            sampleUser: summarizeUser(users[0]),
          },
          null,
          2
        )
      );
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

  listUsers,
};
