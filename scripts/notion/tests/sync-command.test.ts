const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadSyncRules,
  getSyncFieldMappings,
  getCsvRowSyncId,
  buildCsvSyncPayload,
  discoverSyncSources,
} = require('../commands/sync');

function createTempRulesWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-sync-rules-'));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, cleanup };
}

function writeRuleFile(root, name, content) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function withWorkingDirectory(nextCwd, callback) {
  const originalCwd = process.cwd();
  process.chdir(nextCwd);
  try {
    return callback();
  } finally {
    process.chdir(originalCwd);
  }
}

describe('sync command helpers', () => {
  test('accepts csv rules with mapping and destination kind/id', () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
mapping:
  - fromName: Name
    toName: Name
destination:
  kind: db
  id: "db-123"
`
      );

      const rules = loadSyncRules(workspace.root);
      expect(rules).toHaveLength(1);
      expect(rules[0].sourceFormat).toBe('csv');
      expect(rules[0].destination).toEqual({
        kind: 'db',
        id: 'db-123',
        databaseId: 'db-123',
      });
      expect(rules[0].syncIdColumn).toBeUndefined();
      expect(getSyncFieldMappings(rules[0], { Name: 'Ship it' }, 'csv')).toEqual([
        { fromName: 'Name', toName: 'Name', toType: undefined },
      ]);
    } finally {
      workspace.cleanup();
    }
  });

  test('rejects csv rules that still use fmToSync', () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
fmToSync:
  - name: Name
mapping:
  - fromName: Name
destination:
  kind: db
  id: "db-123"
`
      );

      expect(() => loadSyncRules(workspace.root)).toThrow(/cannot use fmToSync/);
    } finally {
      workspace.cleanup();
    }
  });

  test('rejects csv rules without mapping', () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
destination:
  kind: db
  id: "db-123"
`
      );

      expect(() => loadSyncRules(workspace.root)).toThrow(/missing mapping/);
    } finally {
      workspace.cleanup();
    }
  });

  test('rejects destination.kind page for csv rules', () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
mapping:
  - fromName: Name
destination:
  kind: page
  id: "page-123"
`
      );

      expect(() => loadSyncRules(workspace.root)).toThrow(/not implemented yet/);
    } finally {
      workspace.cleanup();
    }
  });

  test('rejects invalid process exports', () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(workspace.root, 'processor.js', 'module.exports = { nope: true };\n');
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
mapping:
  - fromName: Name
    process: "./processor.js"
destination:
  kind: db
  id: "db-123"
`
      );

      expect(() => loadSyncRules(workspace.root)).toThrow(/must export a function/);
    } finally {
      workspace.cleanup();
    }
  });

  test('stable csv sync id prefers dendron_id and id before hashing', () => {
    const rule = {
      ruleName: 'csv',
      mapping: [{ fromName: 'Name', toName: 'Name' }],
    };

    expect(getCsvRowSyncId({ dendron_id: 'existing', Name: 'A' }, rule)).toBe('existing');
    expect(getCsvRowSyncId({ id: 'source-id', Name: 'A' }, rule)).toBe('source-id');
  });

  test('stable csv sync id prefers syncIdColumn when configured', () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
syncIdColumn: external_id
mapping:
  - fromName: Name
    toName: Name
destination:
  kind: db
  id: "db-123"
`
      );

      const [rule] = loadSyncRules(workspace.root);
      expect(rule.syncIdColumn).toBe('external_id');
      expect(
        getCsvRowSyncId(
          {
            external_id: 'external-123',
            dendron_id: 'persisted-metadata',
            id: 'row-id',
            Name: 'Ship it',
          },
          rule
        )
      ).toBe('external-123');
    } finally {
      workspace.cleanup();
    }
  });

  test('stable csv sync id hashes mapping values deterministically', () => {
    const rule = {
      ruleName: 'csv',
      mapping: [
        { fromName: 'Name', toName: 'Name' },
        { fromName: 'Status', toName: 'Status' },
      ],
    };

    const rowA = { Name: 'Ship it', Status: 'In Progress' };
    const rowB = { Status: 'In Progress', Name: 'Ship it' };
    expect(getCsvRowSyncId(rowA, rule)).toBe(getCsvRowSyncId(rowB, rule));
  });

  test('filters csv mappings to selected columns for update operations', () => {
    const rule = {
      mapping: [
        { fromName: 'Name', toName: 'Title' },
        { fromName: 'Status', toName: 'Status' },
        { fromName: 'Summary', toType: 'body' },
      ],
    };

    expect(getSyncFieldMappings(rule, {}, 'csv', new Set(['Status', 'Title']))).toEqual([
      { fromName: 'Name', toName: 'Title' },
      { fromName: 'Status', toName: 'Status' },
    ]);
  });

  test('filters markdown mappings to selected columns for update operations', () => {
    const rule = {
      fmToSync: [
        { name: 'title', target: 'Name' },
        { name: 'proj', target: 'Project' },
        { name: 'priority' },
      ],
    };

    expect(getSyncFieldMappings(rule, {}, 'md', new Set(['Name', 'priority']))).toEqual([
      { name: 'title', target: 'Name' },
      { name: 'priority' },
    ]);
  });

  test('discovers mixed markdown and csv sources for explicit directories', () => {
    const workspace = createTempRulesWorkspace();

    try {
      const notesDir = path.join(workspace.root, 'notes');
      fs.mkdirSync(notesDir, { recursive: true });
      const notePath = path.join(notesDir, 'task.one.md');
      const csvPath = path.join(workspace.root, 'task.two.csv');
      fs.writeFileSync(notePath, '---\nid: one\nfname: task.one\n---\nbody\n', 'utf8');
      fs.writeFileSync(csvPath, 'Name\nRow\n', 'utf8');

      const sources = withWorkingDirectory(workspace.root, () =>
        discoverSyncSources({
          target: null,
          extraPaths: ['.'],
          rules: [{ sourceFormat: 'md' }, { sourceFormat: 'csv' }],
        })
      );

      expect(sources).toHaveLength(2);
      expect(sources).toEqual(
        expect.arrayContaining([
          { sourceFormat: 'md', filePath: fs.realpathSync(notePath) },
          { sourceFormat: 'csv', filePath: fs.realpathSync(csvPath) },
        ])
      );
    } finally {
      workspace.cleanup();
    }
  });

  test('adds explicit paths on top of default roots', () => {
    const workspace = createTempRulesWorkspace();

    try {
      const notesDir = path.join(workspace.root, 'notes');
      const extraDir = path.join(workspace.root, 'extra');
      fs.mkdirSync(notesDir, { recursive: true });
      fs.mkdirSync(extraDir, { recursive: true });
      const notePath = path.join(notesDir, 'task.one.md');
      const csvPath = path.join(extraDir, 'task.two.csv');
      fs.writeFileSync(notePath, '---\nid: one\nfname: task.one\n---\nbody\n', 'utf8');
      fs.writeFileSync(csvPath, 'Name\nRow\n', 'utf8');

      const sources = withWorkingDirectory(workspace.root, () =>
        discoverSyncSources({
          target: null,
          extraPaths: ['./extra'],
          rules: [{ sourceFormat: 'md' }, { sourceFormat: 'csv' }],
        })
      );

      expect(sources).toHaveLength(2);
      expect(sources).toEqual(
        expect.arrayContaining([
          { sourceFormat: 'md', filePath: fs.realpathSync(notePath) },
          { sourceFormat: 'csv', filePath: fs.realpathSync(csvPath) },
        ])
      );
    } finally {
      workspace.cleanup();
    }
  });

  test('errors when default discovery finds both markdown and csv sources', () => {
    const workspace = createTempRulesWorkspace();

    try {
      const notesDir = path.join(workspace.root, 'notes');
      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, 'task.one.md'), '---\nid: one\nfname: task.one\n---\nbody\n', 'utf8');
      fs.writeFileSync(path.join(workspace.root, 'task.two.csv'), 'Name\nRow\n', 'utf8');

      expect(() =>
        withWorkingDirectory(workspace.root, () =>
          discoverSyncSources({
            target: null,
            extraPaths: [],
            rules: [{ sourceFormat: 'md' }, { sourceFormat: 'csv' }],
          })
        )
      ).toThrow(/Ambiguous default sync scope/);
    } finally {
      workspace.cleanup();
    }
  });

  test('builds csv payload with ordered body fragments and default toName', async () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'body-processor.js',
        `module.exports = ({ column, value, helper }) => [
  helper.asBody(column + ':' + value),
  helper.asBody('helper:' + typeof helper.uploadFile),
];
`
      );
      const csvPath = writeRuleFile(workspace.root, 'rows.csv', 'ignored\n');
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
mapping:
  - fromName: Name
  - fromName: Summary
    toType: body
  - fromName: Details
    process: "./body-processor.js"
destination:
  kind: db
  id: "db-123"
`
      );

      const [rule] = loadSyncRules(workspace.root);
      const payload = await buildCsvSyncPayload({
        client: null,
        rule,
        row: {
          Name: 'Ship it',
          Summary: 'summary body',
          Details: 'details value',
          dendron_id: 'csv:test',
        },
        schema: {
          propNameToType: {
            Name: 'title',
            dendron_id: 'rich_text',
            last_synced: 'date',
          },
          relationDatabaseIdByProp: {},
          titlePropName: 'Name',
        },
        lastSyncedIso: '2026-03-13T00:00:00.000Z',
        existingProperties: null,
        schemaCache: new Map(),
        databaseIdCache: new Map(),
        relationCache: new Map(),
        env: 'test',
        dryRun: true,
        sourceFilePath: csvPath,
      });

      expect(payload.properties.Name.title[0].text.content).toBe('Ship it');
      expect(payload.body).toBe('summary body\n\nDetails:details value\n\nhelper:function');
    } finally {
      workspace.cleanup();
    }
  });

  test('plans deferred file/image actions in mapping order', async () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'file-processor.js',
        `module.exports = ({ value, helper }) => helper.uploadFile({ url: value, type: 'image' });\n`
      );
      const csvPath = writeRuleFile(workspace.root, 'rows.csv', 'ignored\n');
      const localImagePath = writeRuleFile(workspace.root, 'local.png', 'png');
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
mapping:
  - fromName: LocalFile
    toType: file/image
  - fromName: RemoteImage
    process: "./file-processor.js"
destination:
  kind: db
  id: "db-123"
`
      );

      const [rule] = loadSyncRules(workspace.root);
      const payload = await buildCsvSyncPayload({
        client: null,
        rule,
        row: {
          LocalFile: './local.png',
          RemoteImage: 'https://example.com/image.png',
          dendron_id: 'csv:test',
        },
        schema: {
          propNameToType: {
            dendron_id: 'rich_text',
            last_synced: 'date',
            Name: 'title',
          },
          relationDatabaseIdByProp: {},
          titlePropName: 'Name',
        },
        lastSyncedIso: '2026-03-13T00:00:00.000Z',
        existingProperties: null,
        schemaCache: new Map(),
        databaseIdCache: new Map(),
        relationCache: new Map(),
        env: 'test',
        dryRun: true,
        sourceFilePath: csvPath,
      });

      expect(payload.fileActions).toEqual([
        {
          source: 'local',
          filePath: localImagePath,
          blockType: 'image',
        },
        {
          source: 'external',
          url: 'https://example.com/image.png',
          blockType: 'image',
        },
      ]);
    } finally {
      workspace.cleanup();
    }
  });

  test('supports imperative helper.uploadFile calls inside process functions', async () => {
    const workspace = createTempRulesWorkspace();

    try {
      writeRuleFile(
        workspace.root,
        'json-list-processor.js',
        `module.exports = (opts) => {
  const data = JSON.parse(opts.value);
  data.forEach((ent) => {
    if (ent && ent.url) {
      opts.helper.uploadFile(ent.url, { type: 'image' });
    }
  });
};
`
      );
      const csvPath = writeRuleFile(workspace.root, 'rows.csv', 'ignored\n');
      writeRuleFile(
        workspace.root,
        'csv.yaml',
        `fnameTrigger: "task.csv-*"
mapping:
  - fromName: Assets
    process: "./json-list-processor.js"
    toType: file/image
destination:
  kind: db
  id: "db-123"
`
      );

      const [rule] = loadSyncRules(workspace.root);
      const payload = await buildCsvSyncPayload({
        client: null,
        rule,
        row: {
          Assets:
            '[{"url":"https://media.hingenexus.com/image/upload/1bn7eo08zcilbxgkn0zd.jpg","cdn_id":"1bn7eo08zcilbxgkn0zd","content_id":"33585559-3c42-45e9-8a10-d69b69a75088"},{}]',
          dendron_id: 'csv:test',
        },
        schema: {
          propNameToType: {
            dendron_id: 'rich_text',
            last_synced: 'date',
            Name: 'title',
          },
          relationDatabaseIdByProp: {},
          titlePropName: 'Name',
        },
        lastSyncedIso: '2026-03-13T00:00:00.000Z',
        existingProperties: null,
        schemaCache: new Map(),
        databaseIdCache: new Map(),
        relationCache: new Map(),
        env: 'test',
        dryRun: true,
        sourceFilePath: csvPath,
      });

      expect(payload.fileActions).toEqual([
        {
          source: 'external',
          url: 'https://media.hingenexus.com/image/upload/1bn7eo08zcilbxgkn0zd.jpg',
          blockType: 'image',
        },
      ]);
    } finally {
      workspace.cleanup();
    }
  });
});
