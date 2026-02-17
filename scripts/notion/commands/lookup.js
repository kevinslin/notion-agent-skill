const { Client } = require('@notionhq/client');

const LOOKUP_OBJECT_FILTER_VALUES = ['page', 'database', 'data_source'];

function normalizeSortDirection(direction) {
  if (!direction) {
    throw new Error('Sort direction is required. Use ascending or descending.');
  }

  const normalized = String(direction).trim().toLowerCase();
  if (normalized === 'asc') return 'ascending';
  if (normalized === 'desc') return 'descending';
  if (normalized === 'ascending' || normalized === 'descending') {
    return normalized;
  }

  throw new Error(
    `Invalid sort direction "${direction}". Supported directions: ascending, descending.`
  );
}

function parseLookupSort(rawSort) {
  if (!rawSort) return null;

  const raw = String(rawSort).trim();
  const [timestampRaw, direction, ...rest] = raw.split(':');
  const timestamp = String(timestampRaw || '').trim().toLowerCase();

  if (rest.length > 0 || !timestamp || !direction) {
    throw new Error(
      'Invalid --sort syntax. Expected "last_edited_time:ascending" or "last_edited_time:descending".'
    );
  }

  if (timestamp !== 'last_edited_time') {
    throw new Error(
      `Unsupported sort timestamp "${timestamp}". Only "last_edited_time" is supported.`
    );
  }

  return {
    timestamp: 'last_edited_time',
    direction: normalizeSortDirection(direction),
  };
}

function normalizeLookupFilterValue(value) {
  const normalized = String(value).trim().toLowerCase();

  if (!LOOKUP_OBJECT_FILTER_VALUES.includes(normalized)) {
    throw new Error(
      `Unsupported lookup object filter "${value}". Supported values: ${LOOKUP_OBJECT_FILTER_VALUES.join(', ')}.`
    );
  }

  // Backward-compatibility with the currently pinned SDK/API model.
  if (normalized === 'data_source') {
    return 'database';
  }

  return normalized;
}

function parseLookupFilter(rawFilter) {
  if (!rawFilter) return null;

  const raw = String(rawFilter).trim();
  const [propertyRaw, value, ...rest] = raw.split(':');
  const property = String(propertyRaw || '').trim().toLowerCase();

  if (rest.length > 0 || !property || !value) {
    throw new Error(
      'Invalid --filter syntax. Expected "object:page" or "object:database".'
    );
  }

  if (property !== 'object') {
    throw new Error(
      `Unsupported lookup filter property "${property}". Only "object" is supported.`
    );
  }

  return {
    property: 'object',
    value: normalizeLookupFilterValue(value),
  };
}

function getPageTitle(page) {
  if (!page || !page.properties || typeof page.properties !== 'object') {
    return 'Untitled';
  }

  const titleProperty = Object.values(page.properties).find(
    (property) => property && property.type === 'title'
  );

  if (!titleProperty || !Array.isArray(titleProperty.title)) {
    return 'Untitled';
  }

  const title = titleProperty.title.map((part) => part.plain_text || '').join('');
  return title || 'Untitled';
}

function getDatabaseTitle(database) {
  if (!database || !Array.isArray(database.title)) {
    return 'Untitled';
  }
  const title = database.title.map((part) => part.plain_text || '').join('');
  return title || 'Untitled';
}

function summarizeParent(parent) {
  if (!parent || !parent.type) {
    return null;
  }

  switch (parent.type) {
    case 'workspace':
      return { type: 'workspace', workspace: true };
    case 'page_id':
      return { type: 'page_id', page_id: parent.page_id };
    case 'database_id':
      return { type: 'database_id', database_id: parent.database_id };
    case 'block_id':
      return { type: 'block_id', block_id: parent.block_id };
    default:
      return { type: parent.type };
  }
}

function normalizeSearchResult(result) {
  const objectType = result && result.object ? result.object : 'unknown';
  let title = 'Untitled';

  if (objectType === 'page') {
    title = getPageTitle(result);
  } else if (objectType === 'database') {
    title = getDatabaseTitle(result);
  }

  return {
    id: result?.id || null,
    object: objectType,
    title,
    url: result?.url || null,
    last_edited_time: result?.last_edited_time || null,
    parent: summarizeParent(result?.parent),
  };
}

async function lookup({ client, query, filter, sort, limit, startCursor }) {
  const results = [];
  let hasMore = true;
  let nextCursor = startCursor;
  const maxResults = Number.isFinite(limit) ? limit : Infinity;

  if (maxResults <= 0) {
    return [];
  }

  while (hasMore && results.length < maxResults) {
    const pageSize = Number.isFinite(maxResults)
      ? Math.min(100, maxResults - results.length)
      : 100;

    const response = await client.search({
      query: query || undefined,
      filter: filter || undefined,
      sort: sort || undefined,
      page_size: pageSize,
      start_cursor: nextCursor,
    });

    const normalized = (response.results || []).map(normalizeSearchResult);
    results.push(...normalized);

    hasMore = response.has_more;
    nextCursor = response.next_cursor;
  }

  return results;
}

function formatLookupTable(results) {
  if (!results.length) {
    return 'No results.';
  }

  const lines = ['\nResults:\n'];
  results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title} [${item.object}]`);
    lines.push(`   ID:   ${item.id || 'n/a'}`);
    lines.push(`   URL:  ${item.url || 'n/a'}`);
    lines.push(`   Edit: ${item.last_edited_time || 'n/a'}`);
    if (item.parent && item.parent.type) {
      lines.push(`   Parent: ${item.parent.type}`);
    }
    lines.push('');
  });
  lines.push(`Total: ${results.length} result(s)`);

  return lines.join('\n');
}

module.exports = {
  command: 'lookup [query]',
  describe: 'Search Notion pages and databases by query text',

  builder: (yargs) => {
    return yargs
      .positional('query', {
        type: 'string',
        describe: 'Query text (title/content keywords)',
      })
      .option('filter', {
        type: 'string',
        describe: 'Search filter in syntax "object:page" or "object:database"',
      })
      .option('sort', {
        type: 'string',
        describe:
          'Sort option in syntax "last_edited_time:ascending" or "last_edited_time:descending"',
      })
      .option('limit', {
        type: 'number',
        describe: 'Maximum number of results to return (default: all)',
      })
      .option('start-cursor', {
        type: 'string',
        describe: 'Optional pagination cursor to continue from',
      })
      .option('format', {
        type: 'string',
        describe: 'Output format',
        choices: ['json', 'table'],
        default: 'json',
      })
      .example('$0 lookup "project alpha"')
      .example('$0 lookup "project alpha" --filter object:page')
      .example('$0 lookup --filter object:database --sort last_edited_time:descending --limit 10');
  },

  handler: async (argv) => {
    try {
      const {
        query,
        filter: rawFilter,
        sort: rawSort,
        limit,
        startCursor,
        format,
      } = argv;

      if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
        throw new Error('--limit must be a non-negative number.');
      }

      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      const filter = parseLookupFilter(rawFilter);
      const sort = parseLookupSort(rawSort);

      const client = new Client({ auth: token });
      const results = await lookup({
        client,
        query,
        filter,
        sort,
        limit,
        startCursor,
      });

      if (format === 'table') {
        console.log(formatLookupTable(results));
      } else {
        console.log(JSON.stringify(results, null, 2));
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

  // Exports for testing
  normalizeSortDirection,
  parseLookupSort,
  normalizeLookupFilterValue,
  parseLookupFilter,
  getPageTitle,
  getDatabaseTitle,
  summarizeParent,
  normalizeSearchResult,
  lookup,
  formatLookupTable,
};
