const { Client } = require('@notionhq/client');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFilter } = require('../utils');
const { listDatabases } = require('./list-db');

function getCacheFilePath(env) {
  const homeDir = os.homedir();
  return path.join(homeDir, `.notion-cache.${env}.json`);
}

function loadDatabaseCache(env) {
  const cachePath = getCacheFilePath(env);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function findDatabaseMatches(databases, name) {
  const normalized = normalizeName(name);
  const exactMatches = databases.filter(
    (db) => normalizeName(db.title) === normalized
  );

  if (exactMatches.length) {
    return { matches: exactMatches, matchType: 'exact' };
  }

  const partialMatches = databases.filter(
    (db) => normalizeName(db.title).includes(normalized)
  );

  return { matches: partialMatches, matchType: 'partial' };
}

function formatMatchList(matches) {
  return matches
    .map((db) => `${db.title} (${db.id})`)
    .join(', ');
}

async function resolveDatabaseId({ client, databaseId, databaseName, env }) {
  if (databaseId) {
    return { id: databaseId, title: null };
  }

  if (!databaseName) {
    throw new Error('Either --database-id or --database-name is required.');
  }

  const cache = loadDatabaseCache(env);
  const cacheMatches = cache ? findDatabaseMatches(cache, databaseName) : null;

  if (cacheMatches && cacheMatches.matches.length === 1) {
    return {
      id: cacheMatches.matches[0].id,
      title: cacheMatches.matches[0].title,
    };
  }

  if (cacheMatches && cacheMatches.matches.length > 1) {
    throw new Error(
      `Multiple databases matched "${databaseName}" in cache (${cacheMatches.matchType}). ` +
        `Matches: ${formatMatchList(cacheMatches.matches)}.`
    );
  }

  const databases = await listDatabases({ client, limit: 1000 });
  const apiMatches = findDatabaseMatches(databases, databaseName);

  if (apiMatches.matches.length === 1) {
    return {
      id: apiMatches.matches[0].id,
      title: apiMatches.matches[0].title,
    };
  }

  if (apiMatches.matches.length > 1) {
    throw new Error(
      `Multiple databases matched "${databaseName}" via API (${apiMatches.matchType}). ` +
        `Matches: ${formatMatchList(apiMatches.matches)}.`
    );
  }

  throw new Error(
    `No database found with name "${databaseName}". ` +
      'Run `node notion.js list-db` or `node notion.js sync-meta` to inspect available databases.'
  );
}

async function getDatabaseSchema({ client, databaseId }) {
  const db = await client.databases.retrieve({ database_id: databaseId });
  const propertySchema = {};
  let titlePropName = null;

  for (const [propName, schema] of Object.entries(db.properties || {})) {
    propertySchema[propName] = schema.type;
    if (schema.type === 'title' && !titlePropName) {
      titlePropName = propName;
    }
  }

  if (!titlePropName) {
    throw new Error('Database is missing a title property.');
  }

  return { propertySchema, titlePropName };
}

function plainTextFromRichText(richText) {
  if (!Array.isArray(richText)) {
    return '';
  }
  return richText.map((item) => item.plain_text || '').join('');
}

function formatUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name || null,
    email: user.person ? user.person.email : null,
  };
}

function formatFile(file) {
  if (!file) return null;
  const url =
    file.type === 'external'
      ? file.external?.url
      : file.file
        ? file.file.url
        : null;
  return {
    name: file.name || null,
    url: url || null,
  };
}

function simplifyPropertyValue(property) {
  if (!property || !property.type) return property;

  switch (property.type) {
    case 'title':
      return plainTextFromRichText(property.title);
    case 'rich_text':
      return plainTextFromRichText(property.rich_text);
    case 'number':
      return property.number;
    case 'select':
      return property.select ? property.select.name : null;
    case 'multi_select':
      return (property.multi_select || []).map((item) => item.name);
    case 'status':
      return property.status ? property.status.name : null;
    case 'date':
      if (!property.date) return null;
      if (property.date.end || property.date.time_zone) {
        return property.date;
      }
      return property.date.start;
    case 'checkbox':
      return property.checkbox;
    case 'url':
      return property.url;
    case 'email':
      return property.email;
    case 'phone_number':
      return property.phone_number;
    case 'people':
      return (property.people || []).map(formatUser);
    case 'relation':
      return (property.relation || []).map((rel) => rel.id);
    case 'files':
      return (property.files || []).map(formatFile);
    case 'created_time':
      return property.created_time;
    case 'last_edited_time':
      return property.last_edited_time;
    case 'created_by':
      return formatUser(property.created_by);
    case 'last_edited_by':
      return formatUser(property.last_edited_by);
    case 'formula':
      if (!property.formula) return null;
      return property.formula[property.formula.type];
    case 'rollup':
      return property.rollup || null;
    default:
      return property;
  }
}

function simplifyProperties(properties, titlePropName) {
  const result = {};
  for (const [name, property] of Object.entries(properties || {})) {
    if (name === titlePropName) {
      continue;
    }
    result[name] = simplifyPropertyValue(property);
  }
  return result;
}

function getFilterDepth(filter) {
  if (!filter) return 0;
  if (filter.and) {
    const depths = filter.and.map(getFilterDepth);
    return 1 + Math.max(0, ...depths);
  }
  if (filter.or) {
    const depths = filter.or.map(getFilterDepth);
    return 1 + Math.max(0, ...depths);
  }
  return 0;
}

function buildQueryFilter({ titlePropName, query }) {
  if (!query) return null;
  return {
    property: titlePropName,
    title: {
      contains: query,
    },
  };
}

function combineFilters(queryFilter, parsedFilter) {
  if (queryFilter && parsedFilter) {
    if (parsedFilter.and && Array.isArray(parsedFilter.and)) {
      return { and: [...parsedFilter.and, queryFilter] };
    }

    const depth = getFilterDepth(parsedFilter);
    if (depth >= 2) {
      throw new Error(
        'Combining --query with --filter exceeds Notion filter nesting limits. ' +
          'Include the title filter directly in --filter instead.'
      );
    }

    return { and: [parsedFilter, queryFilter] };
  }

  return queryFilter || parsedFilter || null;
}

async function fetchPages({ client, databaseId, filter, limit }) {
  const results = [];
  let hasMore = true;
  let startCursor = undefined;
  const maxResults = Number.isFinite(limit) ? limit : Infinity;

  if (maxResults <= 0) {
    return results;
  }

  while (hasMore && results.length < maxResults) {
    const pageSize = Math.min(100, maxResults - results.length);
    const response = await client.databases.query({
      database_id: databaseId,
      filter: filter || undefined,
      page_size: pageSize,
      start_cursor: startCursor,
    });

    results.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return results;
}

async function fetchBlockChildren({ client, blockId }) {
  const blocks = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await client.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: startCursor,
    });

    blocks.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return blocks;
}

function blockToMarkdown(block) {
  if (!block || !block.type) return '';
  const type = block.type;
  const value = block[type];
  if (!value) return '';

  const text = plainTextFromRichText(value.rich_text);

  switch (type) {
    case 'paragraph':
      return text;
    case 'heading_1':
      return text ? `# ${text}` : '#';
    case 'heading_2':
      return text ? `## ${text}` : '##';
    case 'heading_3':
      return text ? `### ${text}` : '###';
    case 'bulleted_list_item':
      return text ? `- ${text}` : '-';
    case 'numbered_list_item':
      return text ? `1. ${text}` : '1.';
    case 'to_do':
      return `- [${value.checked ? 'x' : ' '}] ${text}`.trimEnd();
    case 'quote':
      return text ? `> ${text}` : '>';
    case 'callout':
      return text ? `> ${text}` : '>';
    case 'code': {
      const language = value.language || '';
      const codeText = text || '';
      return [`\`\`\`${language}`, codeText, '```'].join('\n').trim();
    }
    case 'divider':
      return '---';
    case 'image': {
      const url =
        value.type === 'external'
          ? value.external?.url
          : value.file
            ? value.file.url
            : null;
      return url ? `![image](${url})` : '[image]';
    }
    case 'bookmark':
      return value.url ? `[bookmark] ${value.url}` : '[bookmark]';
    case 'file': {
      const url = value.file ? value.file.url : null;
      return url ? `[file] ${url}` : '[file]';
    }
    case 'video': {
      const url = value.type === 'external' ? value.external?.url : value.file?.url;
      return url ? `[video] ${url}` : '[video]';
    }
    case 'child_page':
      return value.title || '';
    case 'toggle':
      return text;
    default:
      return text;
  }
}

function blocksToBody(blocks) {
  const lines = [];
  for (const block of blocks || []) {
    const line = blockToMarkdown(block);
    if (line === null || line === undefined) continue;
    if (line === '') continue;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

async function buildPageResult({ client, page, titlePropName }) {
  const titleProperty = page.properties ? page.properties[titlePropName] : null;
  const title = titleProperty ? plainTextFromRichText(titleProperty.title) : 'Untitled';
  const properties = simplifyProperties(page.properties || {}, titlePropName);
  const blocks = await fetchBlockChildren({ client, blockId: page.id });
  const body = blocksToBody(blocks);

  return {
    id: page.id,
    title,
    properties,
    body,
  };
}

function formatMarkdownOutput(pageResults) {
  const sections = pageResults.map((result) => {
    const propertiesLine = `- properties: ${JSON.stringify(result.properties)}`;
    const body = result.body ? `\n\n${result.body}` : '';
    return `# ${result.title}\n${propertiesLine}${body}`.trim();
  });

  return sections.join('\n\n---\n\n');
}

module.exports = {
  command: 'fetch',
  describe: 'Fetch pages from a Notion database',

  builder: (yargs) => {
    return yargs
      .option('database-id', {
        type: 'string',
        describe: 'Database ID to fetch from',
      })
      .option('database-name', {
        type: 'string',
        describe: 'Database name to fetch from (uses cache if available)',
      })
      .option('query', {
        type: 'string',
        describe: 'Wildtext query applied to the title property',
      })
      .option('filter', {
        alias: 'filters',
        type: 'string',
        describe: 'Filter string using the filter syntax (see docs)',
      })
      .option('output', {
        type: 'string',
        choices: ['json', 'md'],
        default: 'json',
        describe: 'Output format',
      })
      .option('limit', {
        type: 'number',
        describe: 'Maximum number of pages to return (default: all)',
      })
      .option('env', {
        type: 'string',
        describe: 'Environment (determines cache file)',
        choices: ['production', 'test'],
        default: process.env.NODE_ENV === 'test' ? 'test' : 'production',
      })
      .check((argv) => {
        if (!argv.databaseId && !argv.databaseName) {
          throw new Error('Either --database-id or --database-name is required.');
        }
        if (argv.databaseId && argv.databaseName) {
          throw new Error('Provide only one of --database-id or --database-name.');
        }
        return true;
      })
      .example('$0 fetch --database-id abc123')
      .example('$0 fetch --database-name "Tasks" --query "urgent"')
      .example('$0 fetch --database-id abc123 --filter "Status:equals:Done" --output md');
  },

  handler: async (argv) => {
    try {
      const {
        databaseId,
        databaseName,
        query,
        filter: filterString,
        output,
        limit,
        env,
      } = argv;

      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      const client = new Client({ auth: token });

      const resolved = await resolveDatabaseId({
        client,
        databaseId,
        databaseName,
        env,
      });

      const { propertySchema, titlePropName } = await getDatabaseSchema({
        client,
        databaseId: resolved.id,
      });

      const parsedFilter = filterString ? parseFilter(filterString, propertySchema) : null;
      const queryFilter = buildQueryFilter({ titlePropName, query });
      const combinedFilter = combineFilters(queryFilter, parsedFilter);

      const pages = await fetchPages({
        client,
        databaseId: resolved.id,
        filter: combinedFilter,
        limit,
      });

      const results = [];
      for (const page of pages) {
        const formatted = await buildPageResult({ client, page, titlePropName });
        results.push(formatted);
      }

      if (output === 'md') {
        console.log(formatMarkdownOutput(results));
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
  getCacheFilePath,
  loadDatabaseCache,
  findDatabaseMatches,
  resolveDatabaseId,
  getDatabaseSchema,
  plainTextFromRichText,
  simplifyPropertyValue,
  simplifyProperties,
  getFilterDepth,
  buildQueryFilter,
  combineFilters,
  blockToMarkdown,
  blocksToBody,
  formatMarkdownOutput,
};
