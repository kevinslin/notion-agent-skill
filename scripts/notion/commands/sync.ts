// @ts-nocheck
const crypto = require('crypto');
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
  collectCsvFiles,
  parseCsv,
  serializeCsv,
} = require('../utils');
const { resolveDatabaseId } = require('./fetch');

const NOTION_ONLY_LABEL = 'NOTION_ONLY';
const DEFAULT_IGNORE_DIRS = new Set(['node_modules', '.git', 'syncRules']);
const DEFAULT_RULES_DIR = path.join(os.homedir(), '.notion-agents-skill', 'syncRules');
const CSV_METADATA_COLUMNS = new Set(['id', 'dendron_id', 'fname', 'notion_url', 'last_synced']);
const CSV_TO_TYPES = new Set(['string', 'number', 'body', 'file/image']);
const NOTION_API_VERSION = '2026-03-11';
const CSV_BODY_SEPARATOR = '\n\n';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff']);
const SYNC_OPERATIONS = new Set(['sync', 'update']);
const SYNC_SOURCE_FORMATS = new Set(['md', 'csv']);
const MIME_TYPES_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
};

function normalizeCsvToType(rawType) {
  if (rawType === undefined || rawType === null || rawType === '') {
    return undefined;
  }

  const normalized = String(rawType).trim().toLowerCase();
  if (normalized === 'image' || normalized === 'file') {
    return 'file/image';
  }

  if (!CSV_TO_TYPES.has(normalized)) {
    throw new Error(
      `Invalid mapping toType "${rawType}". Expected one of: string, number, body, file/image.`
    );
  }

  return normalized;
}

function normalizeDestinationKind(rawKind) {
  const normalized = String(rawKind || '').trim().toLowerCase();
  if (normalized === 'db' || normalized === 'database') {
    return 'db';
  }
  if (normalized === 'page') {
    throw new Error('destination.kind "page" is not implemented yet.');
  }
  throw new Error(`Invalid destination.kind "${rawKind}". Expected "db" or "page".`);
}

function resolveProcessorPath(processorRef, ruleFilePath) {
  const baseDir = path.dirname(ruleFilePath);
  if (path.isAbsolute(processorRef)) {
    return processorRef;
  }

  const ruleRelativePath = path.resolve(baseDir, processorRef);
  if (fs.existsSync(ruleRelativePath)) {
    return ruleRelativePath;
  }

  return path.resolve(process.cwd(), processorRef);
}

function loadProcessorFunction(processorRef, ruleFilePath) {
  const resolvedPath = resolveProcessorPath(processorRef, ruleFilePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Processor file not found: ${processorRef}`);
  }

  delete require.cache[resolvedPath];
  const loaded = require(resolvedPath);
  const processFn = typeof loaded === 'function' ? loaded : loaded && typeof loaded.default === 'function' ? loaded.default : null;

  if (typeof processFn !== 'function') {
    throw new Error(`Processor file "${processorRef}" must export a function.`);
  }

  return { processFn, resolvedPath };
}

function normalizeMarkdownRule(rawRule, file, ruleName) {
  const fmToSync = rawRule.fmToSync || [];
  if (!Array.isArray(fmToSync)) {
    throw new Error(`Rule in ${file} has invalid fmToSync; expected array.`);
  }

  if (!rawRule.destination || !rawRule.destination.databaseId) {
    throw new Error(`Rule in ${file} is missing destination.databaseId.`);
  }

  return {
    ...rawRule,
    sourceFormat: 'md',
    fmToSync,
    ruleName,
    destination: {
      ...rawRule.destination,
      databaseId: rawRule.destination.databaseId,
    },
  };
}

function normalizeCsvRule(rawRule, file, fullPath, ruleName) {
  if (rawRule.fmToSync !== undefined) {
    throw new Error(`CSV rule in ${file} cannot use fmToSync. Use mapping instead.`);
  }

  if (!Array.isArray(rawRule.mapping) || !rawRule.mapping.length) {
    throw new Error(`CSV rule in ${file} is missing mapping.`);
  }

  if (!rawRule.destination || typeof rawRule.destination !== 'object') {
    throw new Error(`CSV rule in ${file} is missing destination.`);
  }

  const destinationKind = normalizeDestinationKind(rawRule.destination.kind);
  if (!rawRule.destination.id) {
    throw new Error(`CSV rule in ${file} is missing destination.id.`);
  }

  const mapping = rawRule.mapping.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`CSV rule in ${file} has invalid mapping at index ${index}. Expected object.`);
    }
    if (!entry.fromName) {
      throw new Error(`CSV rule in ${file} has mapping at index ${index} without fromName.`);
    }

    const normalized = {
      ...entry,
      fromName: String(entry.fromName),
      toName: entry.toName ? String(entry.toName) : entry.fromName,
      toType: normalizeCsvToType(entry.toType),
    };

    if (entry.process) {
      const { processFn, resolvedPath } = loadProcessorFunction(entry.process, fullPath);
      normalized.process = entry.process;
      normalized.processFn = processFn;
      normalized.processPath = resolvedPath;
    }

    return normalized;
  });

  return {
    ...rawRule,
    sourceFormat: 'csv',
    ruleName,
    mapping,
    syncIdColumn: rawRule.syncIdColumn ? String(rawRule.syncIdColumn) : undefined,
    ruleFilePath: fullPath,
    destination: {
      kind: destinationKind,
      id: rawRule.destination.id,
      databaseId: rawRule.destination.id,
    },
  };
}

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

function normalizeColumnsOption(columnsOption) {
  if (!columnsOption) {
    return null;
  }

  const values = Array.isArray(columnsOption) ? columnsOption : [columnsOption];
  const normalized = values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  return normalized.length ? new Set(normalized) : null;
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

      const ruleName = rawRule.name || path.basename(file, path.extname(file));
      const isCsvRule = rawRule.mapping !== undefined || rawRule.destination?.kind !== undefined || rawRule.destination?.id !== undefined;
      const normalizedRule = isCsvRule
        ? normalizeCsvRule(rawRule, file, fullPath, ruleName)
        : normalizeMarkdownRule(rawRule, file, ruleName);

      rules.push({
        ...normalizedRule,
        fnameTrigger,
        ruleName,
        ruleFilePath: normalizedRule.ruleFilePath || fullPath,
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

function resolveCsvRoots(extraPaths) {
  const roots = [process.cwd()];

  for (const extraPath of extraPaths || []) {
    const resolved = path.resolve(process.cwd(), extraPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Path does not exist: ${extraPath}`);
    }
    roots.push(resolved);
  }

  return [...new Set(roots)];
}

function collectSourceFiles(rootPath, sourceFormat) {
  if (sourceFormat === 'csv') {
    return collectCsvFiles(rootPath, DEFAULT_IGNORE_DIRS);
  }

  return collectMarkdownFiles(rootPath, DEFAULT_IGNORE_DIRS);
}

function inferSourceFormatFromPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.md') {
    return 'md';
  }
  if (ext === '.csv') {
    return 'csv';
  }
  return null;
}

function resolveExplicitRoots(pathsToResolve) {
  const roots = [];

  for (const rawPath of pathsToResolve || []) {
    const resolved = path.resolve(process.cwd(), rawPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Path does not exist: ${rawPath}`);
    }
    roots.push(resolved);
  }

  return [...new Set(roots)];
}

function collectTypedSourceFiles(roots, sourceFormats) {
  const discovered = new Map();

  for (const sourceFormat of [...new Set(sourceFormats || [])].sort()) {
    if (!SYNC_SOURCE_FORMATS.has(sourceFormat)) {
      continue;
    }

    for (const root of roots || []) {
      for (const filePath of collectSourceFiles(root, sourceFormat)) {
        discovered.set(`${sourceFormat}:${filePath}`, { sourceFormat, filePath });
      }
    }
  }

  return [...discovered.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function discoverSyncSources({ target, extraPaths, rules }) {
  const relevantSourceFormats = [...new Set((rules || []).map((rule) => rule.sourceFormat))].sort();
  if (!relevantSourceFormats.length) {
    return [];
  }

  if (target) {
    if (extraPaths && extraPaths.length) {
      throw new Error('Do not combine a positional target with --path. Provide a single target only.');
    }

    const resolvedTarget = path.resolve(process.cwd(), target);
    if (!fs.existsSync(resolvedTarget)) {
      throw new Error(`Path does not exist: ${target}`);
    }

    const targetStats = fs.statSync(resolvedTarget);
    if (targetStats.isFile()) {
      const sourceFormat = inferSourceFormatFromPath(resolvedTarget);
      if (!sourceFormat) {
        throw new Error(`Unsupported sync target "${target}". Expected a .md or .csv file.`);
      }
      if (!relevantSourceFormats.includes(sourceFormat)) {
        throw new Error(`No matching ${sourceFormat} sync rules found for "${target}".`);
      }
      return [{ sourceFormat, filePath: resolvedTarget }];
    }

    return collectTypedSourceFiles([resolvedTarget], relevantSourceFormats);
  }

  if (extraPaths && extraPaths.length) {
    const explicitRoots = resolveExplicitRoots(extraPaths);
    const discovered = new Map();

    for (const sourceFormat of relevantSourceFormats) {
      const defaultRoots = sourceFormat === 'csv' ? resolveCsvRoots([]) : resolveNoteRoots([]);
      const roots = [...new Set([...defaultRoots, ...explicitRoots])];
      for (const sourceItem of collectTypedSourceFiles(roots, [sourceFormat])) {
        discovered.set(`${sourceItem.sourceFormat}:${sourceItem.filePath}`, sourceItem);
      }
    }

    return [...discovered.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
  }

  const discoveredByFormat = new Map();
  for (const sourceFormat of relevantSourceFormats) {
    const roots = sourceFormat === 'csv' ? resolveCsvRoots([]) : resolveNoteRoots([]);
    discoveredByFormat.set(sourceFormat, collectTypedSourceFiles(roots, [sourceFormat]));
  }

  const discoveredFormats = [...discoveredByFormat.entries()]
    .filter(([, sources]) => sources.length > 0)
    .map(([sourceFormat]) => sourceFormat);

  if (discoveredFormats.length > 1) {
    throw new Error(
      'Ambiguous default sync scope: discovered both markdown and CSV sources. Pass an explicit file, directory, or --path.'
    );
  }

  if (!discoveredFormats.length) {
    return [];
  }

  return discoveredByFormat.get(discoveredFormats[0]) || [];
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

function getSyncFieldMappings(rule, sourceData, sourceFormat, selectedColumns = null) {
  if (sourceFormat === 'csv') {
    const mappings = Array.isArray(rule.mapping) ? rule.mapping : [];
    if (!selectedColumns || !selectedColumns.size) {
      return mappings;
    }

    return mappings.filter((mapping) => {
      const fromName = mapping.fromName ? String(mapping.fromName) : '';
      const toName = mapping.toName ? String(mapping.toName) : fromName;
      return selectedColumns.has(fromName) || selectedColumns.has(toName);
    });
  }

  const mappings = Array.isArray(rule.fmToSync) ? rule.fmToSync : [];
  if (!selectedColumns || !selectedColumns.size) {
    return mappings;
  }

  return mappings.filter((mapping) => {
    const fromName = mapping && mapping.name ? String(mapping.name) : '';
    const toName = mapping && mapping.target ? String(mapping.target) : fromName;
    return selectedColumns.has(fromName) || selectedColumns.has(toName);
  });
}

async function resolveMappedPropertyValue({
  client,
  schema,
  targetName,
  option,
  value,
  existingProperties,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  dryRun,
}) {
  const { propNameToType } = schema;
  const type = propNameToType[targetName];
  if (!type) {
    const available = Object.keys(propNameToType).join(', ');
    throw new Error(`Property "${targetName}" not found in database schema. Available properties: ${available}`);
  }

  const mode = option.mode || 'append';

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
    const resolvedDatabaseId = resolvedByConfig || normalizeNotionId(schemaRelationId) || schemaRelationId;

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

    return buildRelationPropertyValue({
      ids: relationIds,
      mode,
      existingProperty: existingProperties ? existingProperties[targetName] : null,
    });
  }

  return buildPropertyValue({
    type,
    value,
    mode,
    existingProperty: existingProperties ? existingProperties[targetName] : null,
  });
}

function applyRequiredSyncProperties({ properties, schema, dendronId, lastSyncedIso, existingProperties }) {
  const { propNameToType } = schema;
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
}

async function buildProperties({
  client,
  rule,
  sourceData,
  schema,
  lastSyncedIso,
  existingProperties,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  dryRun,
  selectedColumns,
}) {
  const properties = {};

  for (const option of getSyncFieldMappings(rule, sourceData, 'md', selectedColumns)) {
    if (!option || !option.name) {
      continue;
    }

    const value = sourceData[option.name];
    if (isEmptyValue(value)) {
      continue;
    }

    const targetName = option.target || option.name;
    const propertyValue = await resolveMappedPropertyValue({
      client,
      schema,
      targetName,
      option,
      value,
      existingProperties,
      schemaCache,
      databaseIdCache,
      relationCache,
      env,
      dryRun,
    });

    if (propertyValue) {
      properties[targetName] = propertyValue;
    }
  }

  const dendronId = sourceData.dendron_id || sourceData.id;
  if (!dendronId) {
    throw new Error('Sync source is missing required id field for dendron_id.');
  }

  applyRequiredSyncProperties({
    properties,
    schema,
    dendronId,
    lastSyncedIso,
    existingProperties,
  });

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

function getSourceFname(sourceData, filePath) {
  if (sourceData && sourceData.fname) {
    return String(sourceData.fname);
  }
  return path.basename(filePath, path.extname(filePath));
}

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseCsv(raw);
}

function getCsvRowSyncId(row, rule) {
  const configuredSyncId =
    rule && rule.syncIdColumn && row && !isEmptyValue(row[rule.syncIdColumn]) ? row[rule.syncIdColumn] : null;
  if (configuredSyncId) {
    return String(configuredSyncId);
  }

  const explicitId = row.dendron_id || row.id;
  if (explicitId) {
    return String(explicitId);
  }

  const orderedValues = getSyncFieldMappings(rule, row, 'csv').map((mapping) => ({
    fromName: mapping.fromName,
    value: row[mapping.fromName] ?? '',
  }));
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ruleName: rule.ruleName, orderedValues }))
    .digest('hex')
    .slice(0, 24);

  return `csv:${rule.ruleName}:${digest}`;
}

function findMatchingRules(rules, fname) {
  return rules.filter((rule) => matchFnameTrigger(fname, rule.fnameTrigger));
}

function buildDatabaseQueryFilter(propertyType, value) {
  switch (propertyType) {
    case 'rich_text':
      return { rich_text: { equals: String(value) } };
    case 'title':
      return { title: { equals: String(value) } };
    case 'number': {
      const numericValue = Number(value);
      if (Number.isNaN(numericValue)) {
        throw new Error(`Cannot query number property with non-numeric value "${value}".`);
      }
      return { number: { equals: numericValue } };
    }
    case 'url':
      return { url: { equals: String(value) } };
    case 'email':
      return { email: { equals: String(value) } };
    case 'phone_number':
      return { phone_number: { equals: String(value) } };
    default:
      throw new Error(`Unsupported property type "${propertyType}" for lookup.`);
  }
}

async function findPageByPropertyValue({
  client,
  databaseId,
  propertyName,
  propertyType,
  value,
}) {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: {
      property: propertyName,
      ...buildDatabaseQueryFilter(propertyType, value),
    },
    page_size: 2,
  });

  const results = response.results || [];
  if (results.length > 1) {
    throw new Error(`Multiple pages found for ${propertyName}="${value}" in database ${databaseId}.`);
  }

  return results.length ? results[0] : null;
}

function flattenProcessorOutput(value) {
  if (Array.isArray(value)) {
    return value.flatMap(flattenProcessorOutput);
  }
  return [value];
}

function createBodyHelperResult(text) {
  return { __syncKind: 'body', text: text === undefined || text === null ? '' : String(text) };
}

function createFileHelperResult(input) {
  return { __syncKind: 'file', input };
}

function mergeFileHelperArgs(input, options) {
  if (options === undefined || options === null) {
    return input;
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      ...input,
      ...options,
    };
  }

  if (typeof input === 'string') {
    if (isExternalUrl(input)) {
      return { url: input, ...options };
    }

    return { path: input, ...options };
  }

  return input;
}

function isExternalUrl(rawValue) {
  return /^https?:\/\//i.test(String(rawValue || '').trim());
}

function inferFileBlockType(rawValue, explicitType) {
  const normalizedExplicit = String(explicitType || '').trim().toLowerCase();
  if (normalizedExplicit === 'file' || normalizedExplicit === 'image') {
    return normalizedExplicit;
  }

  let pathname = String(rawValue || '');
  if (isExternalUrl(rawValue)) {
    try {
      pathname = new URL(rawValue).pathname;
    } catch (_err) {
      pathname = String(rawValue || '');
    }
  }

  return IMAGE_EXTENSIONS.has(path.extname(pathname).toLowerCase()) ? 'image' : 'file';
}

function getMimeTypeForFile(filePath) {
  return MIME_TYPES_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveLocalFilePath(rawPath, baseDirs) {
  const candidates = [];
  if (path.isAbsolute(rawPath)) {
    candidates.push(rawPath);
  } else {
    for (const baseDir of baseDirs) {
      if (baseDir) {
        candidates.push(path.resolve(baseDir, rawPath));
      }
    }
    candidates.push(path.resolve(process.cwd(), rawPath));
  }

  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) {
    throw new Error(`File not found for upload: ${rawPath}`);
  }

  return resolved;
}

function normalizeDeferredFileAction(input, context) {
  if (input && typeof input === 'object' && input.__syncKind === 'file') {
    return normalizeDeferredFileAction(input.input, context);
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => normalizeDeferredFileAction(item, context));
  }

  if (input === undefined || input === null || input === '') {
    return [];
  }

  if (typeof input === 'string') {
    if (isExternalUrl(input)) {
      return [
        {
          source: 'external',
          url: input,
          blockType: inferFileBlockType(input),
        },
      ];
    }

    return [
      {
        source: 'local',
        filePath: resolveLocalFilePath(input, context.baseDirs),
        blockType: inferFileBlockType(input),
      },
    ];
  }

  if (typeof input !== 'object') {
    throw new Error(`Unsupported file/image mapping value: ${String(input)}`);
  }

  const rawUrl = input.url || input.href;
  if (rawUrl) {
    return [
      {
        source: 'external',
        url: rawUrl,
        blockType: inferFileBlockType(rawUrl, input.blockType || input.type),
      },
    ];
  }

  const rawPath = input.path || input.filePath || input.input || input.src;
  if (!rawPath) {
    throw new Error('File/image mapping objects must include url, path, filePath, input, or src.');
  }

  return [
    {
      source: 'local',
      filePath: resolveLocalFilePath(rawPath, context.baseDirs),
      blockType: inferFileBlockType(rawPath, input.blockType || input.type),
    },
  ];
}

function createCsvProcessHelper(context) {
  return {
    asBody: (text) => createBodyHelperResult(text),
    asFile: (input) => createFileHelperResult(input),
    uploadFile: (input, options) => {
      const marker = createFileHelperResult(mergeFileHelperArgs(input, options));
      context.queuedFileResults.push(marker);
      return marker;
    },
  };
}

function combineProcessedOutputs(processedValue, queuedFileResults) {
  const combined = [];
  const seen = new Set();

  const add = (value) => {
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === 'object') {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    combined.push(value);
  };

  for (const queued of queuedFileResults || []) {
    add(queued);
  }

  for (const item of flattenProcessorOutput(processedValue)) {
    add(item);
  }

  return combined;
}

function normalizePrimitiveMappingValue(value, toType) {
  if (value === undefined || value === null || toType === undefined) {
    return value;
  }

  if (toType === 'number') {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      throw new Error(`Invalid number mapping value: ${value}`);
    }
    return numericValue;
  }

  if (toType === 'string') {
    return String(value);
  }

  return value;
}

async function buildCsvSyncPayload({
  client,
  rule,
  row,
  schema,
  lastSyncedIso,
  existingProperties,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  dryRun,
  sourceFilePath,
  selectedColumns,
}) {
  const properties = {};
  const bodyFragments = [];
  const fileActions = [];
  let shouldTouchBody = false;
  const helperContext = { queuedFileResults: [] };
  const helper = createCsvProcessHelper({
    sourceFilePath,
    ruleFilePath: rule.ruleFilePath,
    queuedFileResults: helperContext.queuedFileResults,
  });
  const fileContext = {
    baseDirs: [
      sourceFilePath ? path.dirname(sourceFilePath) : null,
      rule.ruleFilePath ? path.dirname(rule.ruleFilePath) : null,
    ].filter(Boolean),
  };

  for (const mapping of getSyncFieldMappings(rule, row, 'csv', selectedColumns)) {
    const rawValue = row[mapping.fromName];
    if (isEmptyValue(rawValue) && !mapping.processFn) {
      continue;
    }

    helperContext.queuedFileResults.length = 0;
    const processedValue = mapping.processFn
      ? await mapping.processFn({ column: mapping.fromName, value: rawValue, helper })
      : rawValue;

    const processedItems = mapping.processFn
      ? combineProcessedOutputs(processedValue, helperContext.queuedFileResults)
      : flattenProcessorOutput(processedValue);

    if (!processedItems.length || processedItems.every((item) => isEmptyValue(item))) {
      continue;
    }

    for (const item of processedItems) {
      if (item && typeof item === 'object' && item.__syncKind === 'body') {
        shouldTouchBody = true;
        if (!isEmptyValue(item.text)) {
          bodyFragments.push(String(item.text));
        }
        continue;
      }

      if (item && typeof item === 'object' && item.__syncKind === 'file') {
        shouldTouchBody = true;
        fileActions.push(...normalizeDeferredFileAction(item, fileContext));
        continue;
      }

      if (mapping.toType === 'body') {
        shouldTouchBody = true;
        if (!isEmptyValue(item)) {
          bodyFragments.push(String(item));
        }
        continue;
      }

      if (mapping.toType === 'file/image') {
        shouldTouchBody = true;
        fileActions.push(...normalizeDeferredFileAction(item, fileContext));
        continue;
      }

      const targetName = mapping.toName || mapping.fromName;
      const propertyValue = await resolveMappedPropertyValue({
        client,
        schema,
        targetName,
        option: mapping,
        value: normalizePrimitiveMappingValue(item, mapping.toType),
        existingProperties,
        schemaCache,
        databaseIdCache,
        relationCache,
        env,
        dryRun,
      });

      if (propertyValue) {
        properties[targetName] = propertyValue;
      }
    }
  }

  const dendronId = row.dendron_id || row.id;
  if (!dendronId) {
    throw new Error('Sync source is missing required id field for dendron_id.');
  }

  applyRequiredSyncProperties({
    properties,
    schema,
    dendronId,
    lastSyncedIso,
    existingProperties,
  });

  return {
    properties,
    body: bodyFragments.filter((fragment) => !isEmptyValue(fragment)).join(CSV_BODY_SEPARATOR),
    fileActions,
    shouldTouchBody,
  };
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

async function notionJsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let parsed = {};

  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (_err) {
      parsed = { message: responseText };
    }
  }

  if (!response.ok) {
    const error = new Error(parsed.message || `Notion API request failed (${response.status})`);
    error.body = parsed;
    throw error;
  }

  return parsed;
}

async function uploadLocalFileToNotion({ authToken, filePath }) {
  const createdUpload = await notionJsonRequest('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_API_VERSION,
    },
    body: JSON.stringify({ mode: 'single_part' }),
  });

  const form = new FormData();
  const fileBuffer = await fs.promises.readFile(filePath);
  form.append('file', new Blob([fileBuffer], { type: getMimeTypeForFile(filePath) }), path.basename(filePath));

  await fetch(`https://api.notion.com/v1/file_uploads/${createdUpload.id}/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Notion-Version': NOTION_API_VERSION,
    },
    body: form,
  }).then(async (response) => {
    const responseText = await response.text();
    if (!response.ok) {
      let parsed = {};
      if (responseText) {
        try {
          parsed = JSON.parse(responseText);
        } catch (_err) {
          parsed = { message: responseText };
        }
      }
      const error = new Error(parsed.message || `Notion file upload failed (${response.status})`);
      error.body = parsed;
      throw error;
    }
  });

  return createdUpload.id;
}

function buildExternalFileBlock(fileAction) {
  return {
    object: 'block',
    type: fileAction.blockType,
    [fileAction.blockType]: {
      type: 'external',
      external: { url: fileAction.url },
    },
  };
}

function buildUploadedFileBlock(fileAction, fileUploadId) {
  return {
    object: 'block',
    type: fileAction.blockType,
    [fileAction.blockType]: {
      type: 'file_upload',
      file_upload: { id: fileUploadId },
    },
  };
}

async function appendDeferredFileBlocks({ client, pageId, fileActions, authToken }) {
  if (!fileActions || !fileActions.length) {
    return;
  }

  const blocks = [];
  for (const fileAction of fileActions) {
    if (fileAction.source === 'external') {
      blocks.push(buildExternalFileBlock(fileAction));
      continue;
    }

    const fileUploadId = await uploadLocalFileToNotion({
      authToken,
      filePath: fileAction.filePath,
    });
    blocks.push(buildUploadedFileBlock(fileAction, fileUploadId));
  }

  await appendBlocksInChunks(client, pageId, blocks);
}

async function syncRecord({
  client,
  rule,
  schema,
  sourceData,
  sourceFormat,
  operation,
  body,
  fileActions,
  existingPage,
  dryRun,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  authToken,
  persist,
  sourceFilePath,
  selectedColumns,
}) {
  const syncTimestamp = new Date();
  const lastSyncedFrontmatter = formatLocalDateTime(syncTimestamp);
  const lastSyncedIso = syncTimestamp.toISOString();

  const syncPayload =
    sourceFormat === 'csv'
      ? await buildCsvSyncPayload({
          client,
          rule,
          row: sourceData,
          schema,
          lastSyncedIso,
          existingProperties: existingPage ? existingPage.properties : null,
          schemaCache,
          databaseIdCache,
          relationCache,
          env,
          dryRun,
          sourceFilePath,
          selectedColumns,
        })
      : {
          properties: await buildProperties({
            client,
            rule,
            sourceData,
            schema,
            lastSyncedIso,
            existingProperties: existingPage ? existingPage.properties : null,
            schemaCache,
            databaseIdCache,
            relationCache,
            env,
            dryRun,
            selectedColumns,
          }),
          body,
          fileActions: fileActions || [],
        };

  const effectiveBody = sourceFormat === 'csv' ? syncPayload.body : body;
  const effectiveFileActions = sourceFormat === 'csv' ? syncPayload.fileActions : fileActions || [];
  const shouldTouchBody = sourceFormat === 'csv' ? syncPayload.shouldTouchBody : true;
  const properties = syncPayload.properties;

  sourceData.last_synced = lastSyncedFrontmatter;

  if (!sourceData.notion_url && existingPage && existingPage.url) {
    sourceData.notion_url = existingPage.url;
  }

  if (!sourceData.notion_url) {
    if (operation === 'update') {
      if (!dryRun && persist) {
        persist();
      }
      return { action: dryRun ? 'would_skip_update' : 'skipped_update', url: null };
    }
    ensureTitleProperty({ properties, schema });
    if (dryRun) {
      return { action: 'would_create', url: null };
    }
    const created = await client.pages.create({
      parent: { database_id: rule.destination.databaseId },
      properties,
    });
    const newBlocks = markdownToParagraphBlocks(effectiveBody);
    await appendBlocksInChunks(client, created.id, newBlocks);
    await appendDeferredFileBlocks({
      client,
      pageId: created.id,
      fileActions: effectiveFileActions,
      authToken,
    });
    sourceData.notion_url = created.url;
    if (persist) {
      persist();
    }
    return { action: 'created', url: created.url };
  }

  const pageId = existingPage ? existingPage.id : normalizeNotionId(extractNotionIdFromUrl(sourceData.notion_url));
  if (!pageId) {
    throw new Error('Unable to extract page ID from notion_url.');
  }

  if (dryRun) {
    return { action: 'would_update', url: sourceData.notion_url };
  }

  await client.pages.update({
    page_id: pageId,
    properties,
  });

  if (shouldTouchBody) {
    await replacePageBody({ client, pageId, body: effectiveBody });
    await appendDeferredFileBlocks({
      client,
      pageId,
      fileActions: effectiveFileActions,
      authToken,
    });
  }

  if (persist) {
    persist();
  }

  return { action: 'updated', url: sourceData.notion_url };
}

async function syncMarkdownFile({
  client,
  filePath,
  rule,
  schema,
  operation,
  selectedColumns,
  existingPage,
  dryRun,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  authToken,
}) {
  const parsed = parseNoteFile(filePath);
  const frontmatter = parsed.data || {};
  const noteBody = parsed.body || '';

  return syncRecord({
    client,
    rule,
    schema,
    sourceData: frontmatter,
    sourceFormat: 'md',
    operation,
    body: noteBody,
    fileActions: [],
    existingPage,
    dryRun,
    schemaCache,
    databaseIdCache,
    relationCache,
    env,
    authToken,
    persist: () => {
      const output = serializeFrontmatter(frontmatter, noteBody);
      fs.writeFileSync(filePath, output, 'utf8');
    },
    sourceFilePath: filePath,
    selectedColumns,
  });
}

function consumeLimit(limitState) {
  if (limitState && typeof limitState.remaining === 'number') {
    limitState.remaining -= 1;
  }
}

function applyResultToSummary(summary, result) {
  if (result.action === 'created' || result.action === 'would_create') {
    summary.created += 1;
    return;
  }

  if (result.action === 'skipped_update' || result.action === 'would_skip_update') {
    summary.skipped += 1;
    return;
  }

  summary.updated += 1;
}

async function syncCsvFile({
  client,
  filePath,
  rules,
  operation,
  selectedColumns,
  limitState,
  dryRun,
  summary,
  schemaCache,
  databaseIdCache,
  relationCache,
  env,
  authToken,
}) {
  const parsed = parseCsvFile(filePath);
  const headers = [...parsed.headers];
  const rows = parsed.rows || [];
  const baseFname = path.basename(filePath, path.extname(filePath));

  for (const requiredColumn of ['dendron_id', 'notion_url', 'last_synced']) {
    if (!headers.includes(requiredColumn)) {
      headers.push(requiredColumn);
    }
  }

  const persistCsv = () => {
    fs.writeFileSync(filePath, serializeCsv(headers, rows), 'utf8');
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (limitState && typeof limitState.remaining === 'number' && limitState.remaining <= 0) {
      break;
    }

    const row = rows[rowIndex];
    const noteFname = getSourceFname(row, filePath) || baseFname;
    try {
      const matchingRules = findMatchingRules(rules, noteFname);

      if (!matchingRules.length) {
        summary.skipped += 1;
        consumeLimit(limitState);
        continue;
      }

      if (matchingRules.length > 1) {
        throw new Error(`Row matches multiple rules: ${matchingRules.map((r) => r.ruleName).join(', ')}`);
      }

      summary.matched += 1;
      const rule = matchingRules[0];
      const schema = await getDatabaseSchema(client, schemaCache, rule.destination.databaseId);
      const syncId = getCsvRowSyncId(row, rule);
      if (row.dendron_id !== syncId) {
        row.dendron_id = syncId;
      }

      let existingPage = null;
      if (row.notion_url) {
        const rawId = extractNotionIdFromUrl(row.notion_url);
        if (!rawId) {
          throw new Error('Unable to extract page ID from notion_url.');
        }
        const pageId = normalizeNotionId(rawId);
        existingPage = await client.pages.retrieve({ page_id: pageId });
      } else if (row.dendron_id) {
        existingPage = await findPageByPropertyValue({
          client,
          databaseId: rule.destination.databaseId,
          propertyName: 'dendron_id',
          propertyType: schema.propNameToType.dendron_id,
          value: row.dendron_id,
        });
      }

      const result = await syncRecord({
        client,
        rule,
        schema,
        sourceData: row,
        sourceFormat: 'csv',
        operation,
        body: null,
        fileActions: [],
        existingPage,
        dryRun,
        schemaCache,
        databaseIdCache,
        relationCache,
        env,
        authToken,
        persist: persistCsv,
        sourceFilePath: filePath,
        selectedColumns,
      });
      consumeLimit(limitState);
      applyResultToSummary(summary, result);

      const prefix = dryRun ? 'DRY RUN:' : '✓';
      const url = result.url || '(new)';
      console.log(`${prefix} ${result.action} ${noteFname} [row ${rowIndex + 1}] -> ${url}`);
    } catch (err) {
      const message = err && err.body ? JSON.stringify(err.body, null, 2) : err.message || String(err);
      summary.errors.push({ filePath, message });
      console.error(`! Failed ${filePath} [row ${rowIndex + 1}]: ${message}`);
    }
  }
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
      .option('from', {
        type: 'string',
        hidden: true,
      })
      .option('operation', {
        type: 'string',
        choices: ['sync', 'update'],
        describe: 'Sync behavior for matched records: sync creates/updates, update only updates existing records',
        default: 'sync',
      })
      .option('columns', {
        type: 'array',
        describe: 'Limit sync to the listed source or target fields while still persisting sync metadata',
      })
      .option('limit', {
        type: 'number',
        describe: 'Maximum number of records to process across markdown notes and CSV rows',
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
      .example('$0 sync ./exports/tasks.csv')
      .example('$0 sync --rule task')
      .example('$0 sync --rules-dir ./syncRules')
      .example('$0 sync --path ./notes --path ./exports')
      .example('$0 sync --operation update --columns Status,Priority --limit 10 ./exports/tasks.csv');
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
        from: fromArg,
        operation: operationArg,
        columns: columnsArg,
        limit: limitArg,
        rule: ruleFilter,
        path: extraPaths,
        target,
        dryRun,
        rulesDir: rulesDirInput,
      } = argv;
      if (fromArg !== undefined) {
        throw new Error('--from has been removed. notion sync now infers markdown vs CSV sources from the files you target.');
      }
      const operation = String(operationArg || 'sync').trim().toLowerCase();
      if (!SYNC_OPERATIONS.has(operation)) {
        throw new Error(`Unsupported operation "${operationArg}". Expected one of: sync, update.`);
      }
      const selectedColumns = normalizeColumnsOption(columnsArg);
      const limit = limitArg === undefined ? null : Number(limitArg);
      if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
        throw new Error('--limit must be a positive integer.');
      }

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

      const sourceItems = discoverSyncSources({
        target,
        extraPaths,
        rules,
      });

      summary.total = sourceItems.length;

      if (!summary.total) {
        console.log('No sources found to sync.');
        process.exit(0);
      }

      const client = new Client({ auth: token });
      const schemaCache = new Map();
      const databaseIdCache = new Map();
      const relationCache = new Map();
      const env = process.env.NODE_ENV === 'test' ? 'test' : 'production';
      const limitState = limit === null ? null : { remaining: limit };

      for (const sourceItem of sourceItems) {
        if (limitState && limitState.remaining <= 0) {
          break;
        }

        const { sourceFormat, filePath } = sourceItem;
        if (sourceFormat === 'csv') {
          await syncCsvFile({
            client,
            filePath,
            rules: rules.filter((rule) => rule.sourceFormat === 'csv'),
            operation,
            selectedColumns,
            limitState,
            dryRun,
            summary,
            schemaCache,
            databaseIdCache,
            relationCache,
            env,
            authToken: token,
          });
          continue;
        }

        let noteFname = null;
        try {
          const parsed = parseNoteFile(filePath);
          const frontmatter = parsed.data || {};
          noteFname = getSourceFname(frontmatter, filePath);
          const matchingRules = findMatchingRules(
            rules.filter((rule) => rule.sourceFormat === 'md'),
            noteFname
          );

          if (!matchingRules.length) {
            summary.skipped += 1;
            consumeLimit(limitState);
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

          const result = await syncMarkdownFile({
            client,
            filePath,
            rule,
            schema,
            operation,
            selectedColumns,
            existingPage,
            dryRun,
            schemaCache,
            databaseIdCache,
            relationCache,
            env,
            authToken: token,
          });

          consumeLimit(limitState);
          applyResultToSummary(summary, result);

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
  normalizeCsvRule,
  loadProcessorFunction,
  resolveNoteRoots,
  resolveCsvRoots,
  getDatabaseSchema,
  getSyncFieldMappings,
  getCsvRowSyncId,
  buildProperties,
  buildCsvSyncPayload,
  normalizeDeferredFileAction,
  findPageByPropertyValue,
  resolveRelationDatabaseId,
  resolveRelationIds,
  buildRelationPropertyValue,
  findPageByTitle,
  inferSourceFormatFromPath,
  discoverSyncSources,
  syncRecord,
  syncMarkdownFile,
  syncCsvFile,
};
