const { Client } = require('@notionhq/client');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const {
  coerceValueForPropertyType,
  markdownToParagraphBlocks,
  normalizeNotionId,
  parseFrontmatter,
  serializeFrontmatter,
  matchFnameTrigger,
  parseMultiSelectValues,
  mergeMultiSelectValues,
  formatLocalDateTime,
  extractNotionIdFromUrl,
  ensureDirectoryExists,
  collectMarkdownFiles,
} = require('../utils');
const { resolveDatabaseId } = require('./fetch');

const NOTION_ONLY_LABEL = 'NOTION_ONLY';
const DEFAULT_IGNORE_DIRS = new Set(['node_modules', '.git', 'syncRules']);
const DEFAULT_RULES_DIR = path.join(os.homedir(), '.notion-agents-skill', 'syncRules');

function resolveRulesDir(rulesDir) {
  if (!rulesDir) {
    return DEFAULT_RULES_DIR;
  }

  if (rulesDir === '~') {
    return os.homedir();
  }

  if (rulesDir.startsWith('~/')) {
    return path.join(os.homedir(), rulesDir.slice(2));
  }

  return path.resolve(process.cwd(), rulesDir);
}

function loadSyncRules(rulesDir) {
  ensureDirectoryExists(rulesDir);

  const ruleFiles = fs
    .readdirSync(rulesDir)
    .filter((file) => !file.startsWith('.') && (file.endsWith('.yaml') || file.endsWith('.yml')))
    .sort();

  if (!ruleFiles.length) {
    throw new Error(`No sync rule files found in ${rulesDir}`);
  }

  const rules = [];

  for (const file of ruleFiles) {
    const fullPath = path.join(rulesDir, file);
    let rawRules;

    try {
      rawRules = yaml.load(fs.readFileSync(fullPath, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid YAML in ${file}: ${err.message || err}`);
    }

    if (rawRules && Array.isArray(rawRules.rules)) {
      rawRules = rawRules.rules;
    }

    if (!Array.isArray(rawRules)) {
      rawRules = [rawRules];
    }

    for (const rawRule of rawRules) {
      if (!rawRule || typeof rawRule !== 'object') {
        throw new Error(`Invalid rule export in ${file}. Expected object or array of objects.`);
      }

      const fnameTrigger = rawRule.fnameTrigger || rawRule.fnameToTrigger;
      if (!fnameTrigger) {
        throw new Error(`Rule in ${file} is missing fnameTrigger.`);
      }

      const fmToSync = rawRule.fmToSync || [];
      if (!Array.isArray(fmToSync)) {
        throw new Error(`Rule in ${file} has invalid fmToSync; expected array.`);
      }

      if (!rawRule.destination || !rawRule.destination.databaseId) {
        throw new Error(`Rule in ${file} is missing destination.databaseId.`);
      }

      rules.push({
        ...rawRule,
        fnameTrigger,
        fmToSync,
        ruleName: rawRule.name || path.basename(file, path.extname(file)),
      });
    }
  }

  return rules;
}

function resolveNoteRoots(extraPaths) {
  const roots = [];
  const notesDir = path.resolve(process.cwd(), 'notes');
  if (fs.existsSync(notesDir) && fs.statSync(notesDir).isDirectory()) {
    roots.push(notesDir);
  } else {
    roots.push(process.cwd());
  }

  for (const extraPath of extraPaths || []) {
    const resolved = path.resolve(process.cwd(), extraPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Path does not exist: ${extraPath}`);
    }
    roots.push(resolved);
  }

  return [...new Set(roots)];
}

async function getDatabaseSchema(client, cache, databaseId) {
  if (cache.has(databaseId)) {
    return cache.get(databaseId);
  }

  const db = await client.databases.retrieve({ database_id: databaseId });
  const propNameToType = {};
  const relationDatabaseIdByProp = {};
  let titlePropName = null;

  for (const [propName, schema] of Object.entries(db.properties || {})) {
    propNameToType[propName] = schema.type;
    if (schema.type === 'title' && !titlePropName) {
      titlePropName = propName;
    }
    if (schema.type === 'relation' && schema.relation && schema.relation.database_id) {
      relationDatabaseIdByProp[propName] = schema.relation.database_id;
    }
  }

  const schemaInfo = { propNameToType, titlePropName, relationDatabaseIdByProp };
  cache.set(databaseId, schemaInfo);
  return schemaInfo;
}

function normalizeRelationKey(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveRelationDatabaseId({
  client,
  databaseId,
  databaseName,
  env,
  databaseIdCache,
}) {
  if (databaseId) {
    return normalizeNotionId(databaseId) || databaseId;
  }

  if (!databaseName) {
    return null;
  }

  const cacheKey = normalizeRelationKey(databaseName);
  if (databaseIdCache && databaseIdCache.has(cacheKey)) {
    return databaseIdCache.get(cacheKey);
  }

  const resolved = await resolveDatabaseId({
    client,
    databaseId: null,
    databaseName,
    env,
  });

  if (databaseIdCache) {
    databaseIdCache.set(cacheKey, resolved.id);
  }

  return resolved.id;
}

async function findPageByTitle({
  client,
  databaseId,
  titlePropName,
  title,
}) {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: {
      property: titlePropName,
      title: { equals: title },
    },
    page_size: 2,
  });

  const results = response.results || [];
  if (results.length > 1) {
    throw new Error(`Multiple relation pages found for "${title}" in database ${databaseId}.`);
  }

  return results.length ? results[0].id : null;
}

async function ensureRelationPageId({
  client,
  databaseId,
  titlePropName,
  title,
  errorIfNotFound,
  allowCreate,
}) {
  const existingId = await findPageByTitle({
    client,
    databaseId,
    titlePropName,
    title,
  });

  if (existingId) {
    return existingId;
  }

  if (errorIfNotFound) {
    throw new Error(`Relation target "${title}" not found in database ${databaseId}.`);
  }

  if (!allowCreate) {
    return null;
  }

  const created = await client.pages.create({
    parent: { database_id: databaseId },
    properties: {
      [titlePropName]: coerceValueForPropertyType('title', title),
    },
  });

  return created.id;
}

function buildRelationPropertyValue({ ids, mode, existingProperty }) {
  const normalizedIds = (ids || [])
    .map((id) => normalizeNotionId(id) || id)
    .filter(Boolean);

  if (!normalizedIds.length) {
    return null;
  }

  if (mode === 'append' && existingProperty && Array.isArray(existingProperty.relation)) {
    const existingIds = existingProperty.relation.map((item) => item.id);
    const merged = mergeMultiSelectValues(existingIds, normalizedIds);
    return { relation: merged.map((id) => ({ id })) };
  }

  return { relation: normalizedIds.map((id) => ({ id })) };
}

async function resolveRelationIds({
  client,
  schemaCache,
  relationCache,
  databaseId,
  relationNames,
  errorIfNotFound,
  allowCreate,
}) {
  if (!relationNames.length) {
    return [];
  }

  const relationSchema = await getDatabaseSchema(client, schemaCache, databaseId);
  if (!relationSchema.titlePropName) {
    throw new Error(`Relation database ${databaseId} is missing a title property.`);
  }

  const ids = [];

  for (const name of relationNames) {
    const cacheKey = `${databaseId}:${normalizeRelationKey(name)}`;
    if (relationCache && relationCache.has(cacheKey)) {
      ids.push(relationCache.get(cacheKey));
      continue;
    }

    const relationId = await ensureRelationPageId({
      client,
      databaseId,
      titlePropName: relationSchema.titlePropName,
      title: name,
      errorIfNotFound,
      allowCreate,
    });

    if (!relationId) {
      continue;
    }

    if (relationCache) {
      relationCache.set(cacheKey, relationId);
    }

    ids.push(relationId);
  }

  return ids;
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeDateValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function buildPropertyValue({ type, value, mode, existingProperty }) {
  if (type === 'multi_select') {
    const incoming = parseMultiSelectValues(value);
    if (!incoming.length) {
      return null;
    }

    if (mode === 'append' && existingProperty && Array.isArray(existingProperty.multi_select)) {
      const existingNames = existingProperty.multi_select.map((item) => item.name);
      const merged = mergeMultiSelectValues(existingNames, incoming);
      return { multi_select: merged.map((name) => ({ name })) };
    }

    return { multi_select: incoming.map((name) => ({ name })) };
  }

  if (type === 'checkbox') {
    const checked = value === true || String(value).toLowerCase() === 'true';
    return { checkbox: checked };
  }

  if (type === 'relation') {
    const ids = parseMultiSelectValues(value).map((id) => ({ id: normalizeNotionId(id) }));
    return { relation: ids };
  }

  if (type === 'date') {
    const normalized = normalizeDateValue(value);
    return coerceValueForPropertyType(type, String(normalized));
  }

  return coerceValueForPropertyType(type, String(value));
}

async function buildProperties({
  client,
  rule,
  frontmatter,
  schema,
  lastSyncedIso,
  existingProperties,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  dryRun,
}) {
  const { propNameToType } = schema;
  const properties = {};

  for (const option of rule.fmToSync) {
    if (!option || !option.name) {
      continue;
    }

    const targetName = option.target || option.name;
    const value = frontmatter[option.name];
    if (isEmptyValue(value)) {
      continue;
    }

    const type = propNameToType[targetName];
    if (!type) {
      const available = Object.keys(propNameToType).join(', ');
      throw new Error(`Property "${targetName}" not found in database schema. Available properties: ${available}`);
    }

    const mode = option.mode || 'append';
    let propertyValue = null;

    if (option.type === 'relation' || option.databaseName || option.databaseId) {
      if (type !== 'relation') {
        throw new Error(`Property "${targetName}" is type "${type}" but relation config was provided.`);
      }

      const resolvedByConfig = await resolveRelationDatabaseId({
        client,
        databaseId: option.databaseId,
        databaseName: option.databaseName,
        env,
        databaseIdCache,
      });

      const schemaRelationId = schema.relationDatabaseIdByProp[targetName];
      const resolvedDatabaseId =
        resolvedByConfig || normalizeNotionId(schemaRelationId) || schemaRelationId;

      if (!resolvedDatabaseId) {
        throw new Error(`Relation property "${targetName}" requires databaseName or databaseId.`);
      }

      if (schemaRelationId && normalizeNotionId(schemaRelationId) !== normalizeNotionId(resolvedDatabaseId)) {
        throw new Error(
          `Relation property "${targetName}" targets database ${schemaRelationId}, ` +
            `but resolved database ${resolvedDatabaseId} was provided.`
        );
      }

      const relationNames = parseMultiSelectValues(value);
      const relationIds = await resolveRelationIds({
        client,
        schemaCache,
        relationCache,
        databaseId: resolvedDatabaseId,
        relationNames,
        errorIfNotFound: option.errorIfNotFound === true,
        allowCreate: !dryRun,
      });

      propertyValue = buildRelationPropertyValue({
        ids: relationIds,
        mode,
        existingProperty: existingProperties ? existingProperties[targetName] : null,
      });
    } else {
      propertyValue = buildPropertyValue({
        type,
        value,
        mode,
        existingProperty: existingProperties ? existingProperties[targetName] : null,
      });
    }

    if (propertyValue) {
      properties[targetName] = propertyValue;
    }
  }

  const dendronId = frontmatter.id;
  if (!dendronId) {
    throw new Error('Frontmatter is missing required id field for dendron_id.');
  }

  const requiredMappings = [
    { name: 'dendron_id', value: dendronId },
    { name: 'last_synced', value: lastSyncedIso },
  ];

  for (const mapping of requiredMappings) {
    const type = propNameToType[mapping.name];
    if (!type) {
      const available = Object.keys(propNameToType).join(', ');
      throw new Error(`Required property "${mapping.name}" not found in database schema. Available properties: ${available}`);
    }

    properties[mapping.name] = buildPropertyValue({
      type,
      value: mapping.value,
      mode: 'replace',
      existingProperty: existingProperties ? existingProperties[mapping.name] : null,
    });
  }

  return properties;
}

function ensureTitleProperty({ properties, schema }) {
  if (!schema.titlePropName) {
    throw new Error('Database is missing a title property.');
  }

  if (properties[schema.titlePropName] === undefined) {
    properties[schema.titlePropName] = coerceValueForPropertyType('title', '');
  }
}

function parseNoteFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasFrontmatter) {
    throw new Error('Missing YAML frontmatter.');
  }
  return parsed;
}

function getNoteFname(frontmatter, filePath) {
  if (frontmatter && frontmatter.fname) {
    return String(frontmatter.fname);
  }
  return path.basename(filePath, path.extname(filePath));
}

function findMatchingRules(rules, fname) {
  return rules.filter((rule) => matchFnameTrigger(fname, rule.fnameTrigger));
}

function isNotionOnlyToggle(block) {
  if (!block || block.type !== 'toggle') {
    return false;
  }
  const text = (block.toggle?.rich_text || [])
    .map((item) => item.plain_text)
    .join('')
    .trim();
  return text === NOTION_ONLY_LABEL;
}

async function listAllBlockChildren(client, blockId) {
  const results = [];
  let cursor = undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });

    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return results;
}

async function archiveBlocks(client, blocks) {
  for (const block of blocks) {
    await client.blocks.update({ block_id: block.id, archived: true });
  }
}

function chunkBlocks(blocks, size = 100) {
  const chunks = [];
  for (let i = 0; i < blocks.length; i += size) {
    chunks.push(blocks.slice(i, i + size));
  }
  return chunks;
}

async function appendBlocksInChunks(client, pageId, blocks) {
  if (!blocks || !blocks.length) {
    return;
  }
  const chunks = chunkBlocks(blocks, 100);
  for (const chunk of chunks) {
    await client.blocks.children.append({
      block_id: pageId,
      children: chunk,
    });
  }
}

async function replacePageBody({ client, pageId, body }) {
  const existingBlocks = await listAllBlockChildren(client, pageId);
  const blocksToArchive = existingBlocks.filter((block) => !isNotionOnlyToggle(block));
  if (blocksToArchive.length) {
    await archiveBlocks(client, blocksToArchive);
  }

  if (!body) {
    return;
  }

  const newBlocks = markdownToParagraphBlocks(body);
  if (!newBlocks.length) {
    return;
  }

  await appendBlocksInChunks(client, pageId, newBlocks);
}

async function syncNote({
  client,
  filePath,
  rule,
  schema,
  existingPage,
  dryRun,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
}) {
  const parsed = parseNoteFile(filePath);
  const frontmatter = parsed.data || {};
  const noteBody = parsed.body || '';
  const syncTimestamp = new Date();
  const lastSyncedFrontmatter = formatLocalDateTime(syncTimestamp);
  const lastSyncedIso = syncTimestamp.toISOString();

  const properties = await buildProperties({
    client,
    rule,
    frontmatter,
    schema,
    lastSyncedIso,
    existingProperties: existingPage ? existingPage.properties : null,
    schemaCache,
    databaseIdCache,
    relationCache,
    env,
    dryRun,
  });

  frontmatter.last_synced = lastSyncedFrontmatter;

  if (!frontmatter.notion_url) {
    ensureTitleProperty({ properties, schema });
    if (dryRun) {
      return { action: 'would_create', url: null };
    }
    const created = await client.pages.create({
      parent: { database_id: rule.destination.databaseId },
      properties,
    });
    const newBlocks = markdownToParagraphBlocks(noteBody);
    await appendBlocksInChunks(client, created.id, newBlocks);
    frontmatter.notion_url = created.url;
    const output = serializeFrontmatter(frontmatter, noteBody);
    fs.writeFileSync(filePath, output, 'utf8');
    return { action: 'created', url: created.url };
  }

  const rawId = extractNotionIdFromUrl(frontmatter.notion_url);
  if (!rawId) {
    throw new Error('Unable to extract page ID from notion_url.');
  }
  const pageId = normalizeNotionId(rawId);

  if (dryRun) {
    return { action: 'would_update', url: frontmatter.notion_url };
  }

  await client.pages.update({
    page_id: pageId,
    properties,
  });

  await replacePageBody({ client, pageId, body: noteBody });

  const output = serializeFrontmatter(frontmatter, noteBody);
  fs.writeFileSync(filePath, output, 'utf8');

  return { action: 'updated', url: frontmatter.notion_url };
}

module.exports = {
  command: 'sync [target]',
  describe: 'Sync local notes to Notion using sync rules',

  builder: (yargs) => {
    return yargs
      .positional('target', {
        type: 'string',
        describe: 'File or directory to sync when provided positionally',
      })
      .option('rule', {
        type: 'string',
        describe: 'Only run a specific sync rule (matches rule filename or name)',
      })
      .option('dry-run', {
        type: 'boolean',
        describe: 'Print planned actions without writing changes',
        default: false,
      })
      .option('path', {
        type: 'array',
        describe: 'Additional file or directory paths to scan for notes',
        default: [],
      })
      .option('rules-dir', {
        type: 'string',
        describe: 'Directory containing sync rule YAML files',
      })
      .example('$0 sync')
      .example('$0 sync ./notes/task.2025.12.28.finalize-trip.md')
      .example('$0 sync --rule task')
      .example('$0 sync --rules-dir ./syncRules')
      .example('$0 sync --path ../notes-archive');
  },

  handler: async (argv) => {
    const summary = {
      total: 0,
      matched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const {
        rule: ruleFilter,
        path: extraPaths,
        target,
        dryRun,
        rulesDir: rulesDirInput,
      } = argv;

      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error('NOTION_TOKEN (or NOTION_API_KEY) is required. Set it in the environment or .env file.');
      }

      const rulesDir = resolveRulesDir(rulesDirInput);
      const allRules = loadSyncRules(rulesDir);

      const rules = ruleFilter
        ? allRules.filter((r) => r.ruleName === ruleFilter || r.name === ruleFilter)
        : allRules;

      if (!rules.length) {
        throw new Error(`No matching sync rules found${ruleFilter ? ` for "${ruleFilter}"` : ''}.`);
      }

      let roots = [];
      if (target) {
        if (extraPaths && extraPaths.length) {
          throw new Error('Do not combine a positional target with --path. Provide a single target only.');
        }
        const resolvedTarget = path.resolve(process.cwd(), target);
        if (!fs.existsSync(resolvedTarget)) {
          throw new Error(`Path does not exist: ${target}`);
        }
        roots = [resolvedTarget];
      } else {
        roots = resolveNoteRoots(extraPaths);
      }
      const noteFiles = new Set();

      for (const root of roots) {
        for (const filePath of collectMarkdownFiles(root, DEFAULT_IGNORE_DIRS)) {
          noteFiles.add(filePath);
        }
      }

      summary.total = noteFiles.size;

      if (!summary.total) {
        console.log('No markdown notes found to sync.');
        process.exit(0);
      }

      const client = new Client({ auth: token });
      const schemaCache = new Map();
      const databaseIdCache = new Map();
      const relationCache = new Map();
      const env = process.env.NODE_ENV === 'test' ? 'test' : 'production';

      for (const filePath of noteFiles) {
        let noteFname = null;
        try {
          const parsed = parseNoteFile(filePath);
          const frontmatter = parsed.data || {};
          noteFname = getNoteFname(frontmatter, filePath);
          const matchingRules = findMatchingRules(rules, noteFname);

          if (!matchingRules.length) {
            summary.skipped += 1;
            continue;
          }

          if (matchingRules.length > 1) {
            throw new Error(`Note matches multiple rules: ${matchingRules.map((r) => r.ruleName).join(', ')}`);
          }

          summary.matched += 1;
          const rule = matchingRules[0];
          const schema = await getDatabaseSchema(client, schemaCache, rule.destination.databaseId);

          let existingPage = null;
          if (frontmatter.notion_url) {
            const rawId = extractNotionIdFromUrl(frontmatter.notion_url);
            if (!rawId) {
              throw new Error('Unable to extract page ID from notion_url.');
            }
            const pageId = normalizeNotionId(rawId);
            existingPage = await client.pages.retrieve({ page_id: pageId });
          }

          const result = await syncNote({
            client,
            filePath,
            rule,
            schema,
            existingPage,
            dryRun,
            schemaCache,
            databaseIdCache,
            relationCache,
            env,
          });

          if (result.action === 'created' || result.action === 'would_create') {
            summary.created += 1;
          } else {
            summary.updated += 1;
          }

          const prefix = dryRun ? 'DRY RUN:' : '✓';
          const url = result.url || '(new)';
          console.log(`${prefix} ${result.action} ${noteFname} -> ${url}`);
        } catch (err) {
          const message = err && err.body ? JSON.stringify(err.body, null, 2) : err.message || String(err);
          summary.errors.push({ filePath, message });
          console.error(`! Failed ${noteFname || filePath}: ${message}`);
        }
      }

      if (summary.errors.length) {
        console.error(`\nSync completed with ${summary.errors.length} error(s).`);
        process.exit(1);
      }

      console.log(`\nSync complete. Created: ${summary.created}, Updated: ${summary.updated}, Skipped: ${summary.skipped}`);
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

  loadSyncRules,
  resolveNoteRoots,
  getDatabaseSchema,
  buildProperties,
  resolveRelationDatabaseId,
  resolveRelationIds,
  buildRelationPropertyValue,
  findPageByTitle,
  syncNote,
};
