const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  loadEnv,
  parseFrontmatter,
  serializeFrontmatter,
  extractNotionIdFromUrl,
  normalizeNotionId,
  parseCsv,
} = require('../utils');

// Set NODE_ENV to test so loadEnv loads .env.test
process.env.NODE_ENV = 'test';

// Load .env.test using the loadEnv utility
try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

jest.setTimeout(45000);

describe('Sync Command Integration Tests', () => {
  let client;
  let testDatabaseId;
  const notionCliPath = path.resolve(__dirname, '..', 'notion.js');

  beforeAll(() => {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error('NOTION_TOKEN must be set in .env.test for integration tests');
    }
    client = new Client({ auth: token });

    testDatabaseId = process.env.TEST_DATABASE_ID;
    if (!testDatabaseId) {
      throw new Error('TEST_DATABASE_ID not set in .env.test');
    }
  });

  const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  const createTempWorkspace = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-sync-'));
    const syncRulesDir = path.join(root, 'syncRules');
    const notesDir = path.join(root, 'notes');

    fs.mkdirSync(syncRulesDir, { recursive: true });
    fs.mkdirSync(notesDir, { recursive: true });

    const ruleContent = `fnameTrigger: "task.*"
fmToSync:
  - name: title
    target: Name
  - name: proj
    target: Tags
    mode: append
destination:
  databaseId: "${testDatabaseId}"
`;

    fs.writeFileSync(path.join(syncRulesDir, 'task.yaml'), ruleContent, 'utf8');

    const cleanup = () => {
      fs.rmSync(root, { recursive: true, force: true });
    };

    return { root, notesDir, syncRulesDir, cleanup };
  };

  const writeNote = ({ notesDir, fname, title, proj, body }) => {
    const frontmatter = {
      id: `sync-${uniqueSuffix()}`,
      title,
      proj,
      fname,
    };

    const content = serializeFrontmatter(frontmatter, body);
    const filePath = path.join(notesDir, `${fname}.md`);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  };

  const writeCsv = ({ root, fname, rows }) => {
    const filePath = path.join(root, `${fname}.csv`);
    const headers = Object.keys(rows[0] || {});
    const lines = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => JSON.stringify(String(row[header] || ''))).join(',')),
    ];
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
  };

  const runSyncCommand = ({ cwd, args = [], rulesDir }) => {
    const cliArgs = ['sync'];
    if (!args.includes('--from')) {
      cliArgs.push('--from', 'md');
    }
    if (rulesDir) {
      cliArgs.push('--rules-dir', rulesDir);
    }
    cliArgs.push(...args);

    const result = spawnSync('node', [notionCliPath, ...cliArgs], {
      cwd,
      env: { ...process.env },
      encoding: 'utf8',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const output = result.stderr || result.stdout || '';
      throw new Error(`sync command failed (${result.status}): ${output}`);
    }

    return result.stdout || '';
  };

  const readFrontmatter = (filePath) => {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseFrontmatter(raw);
  };

  const expectSyncedFrontmatter = (parsed) => {
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data.notion_url).toBeTruthy();
    expect(parsed.data.last_synced).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    return parsed.data.notion_url;
  };

  const fetchPage = async (notionUrl) => {
    const rawId = extractNotionIdFromUrl(notionUrl);
    expect(rawId).toBeTruthy();

    const pageId = normalizeNotionId(rawId);
    const page = await client.pages.retrieve({ page_id: pageId });
    expect(page).toBeDefined();
    return page;
  };

  const listPageChildren = async (notionUrl) => {
    const rawId = extractNotionIdFromUrl(notionUrl);
    expect(rawId).toBeTruthy();

    const pageId = normalizeNotionId(rawId);
    const results = [];
    let cursor;

    do {
      const response = await client.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      });
      results.push(...(response.results || []));
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return results;
  };

  const writeTinyPng = (filePath) => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlTH0UAAAAASUVORK5CYII=';
    fs.writeFileSync(filePath, Buffer.from(pngBase64, 'base64'));
    return filePath;
  };

  test('syncs a single note', async () => {
    const workspace = createTempWorkspace();

    try {
      const fname = `task.sync-one-${uniqueSuffix()}`;
      const notePath = writeNote({
        notesDir: workspace.notesDir,
        fname,
        title: `Sync One ${uniqueSuffix()}`,
        proj: 'test',
        body: 'Integration test body for sync one.',
      });

      const stdout = runSyncCommand({ cwd: workspace.root, args: [notePath], rulesDir: workspace.syncRulesDir });
      expect(stdout).toMatch(/Sync complete/);

      const parsed = readFrontmatter(notePath);
      const notionUrl = expectSyncedFrontmatter(parsed);

      const page = await fetchPage(notionUrl);
      expect(page.properties).toHaveProperty('dendron_id');
      expect(page.properties).toHaveProperty('last_synced');
    } finally {
      workspace.cleanup();
    }
  });

  test('syncs all notes in the notes folder', async () => {
    const workspace = createTempWorkspace();

    try {
      const noteA = writeNote({
        notesDir: workspace.notesDir,
        fname: `task.sync-all-a-${uniqueSuffix()}`,
        title: `Sync All A ${uniqueSuffix()}`,
        proj: 'test',
        body: 'Integration test body for sync all A.',
      });

      const noteB = writeNote({
        notesDir: workspace.notesDir,
        fname: `task.sync-all-b-${uniqueSuffix()}`,
        title: `Sync All B ${uniqueSuffix()}`,
        proj: 'test',
        body: 'Integration test body for sync all B.',
      });

      const stdout = runSyncCommand({ cwd: workspace.root, rulesDir: workspace.syncRulesDir });
      expect(stdout).toMatch(/Sync complete/);

      const parsedA = readFrontmatter(noteA);
      const parsedB = readFrontmatter(noteB);

      const urlA = expectSyncedFrontmatter(parsedA);
      const urlB = expectSyncedFrontmatter(parsedB);

      await fetchPage(urlA);
      await fetchPage(urlB);
    } finally {
      workspace.cleanup();
    }
  });

  test('syncs csv rows and persists sync metadata columns', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv.yaml'),
        `fnameTrigger: "task.sync-csv-*"
mapping:
  - fromName: Name
    toName: Name
  - fromName: Status
    toName: Status
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const csvPath = writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            Name: `CSV Sync ${uniqueSuffix()}`,
            Status: 'Not started',
          },
        ],
      });

      const stdout = runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv', csvPath],
        rulesDir: workspace.syncRulesDir,
      });
      expect(stdout).toMatch(/Sync complete/);

      const parsedCsv = parseCsv(fs.readFileSync(csvPath, 'utf8'));
      expect(parsedCsv.rows).toHaveLength(1);
      expect(parsedCsv.rows[0].notion_url).toBeTruthy();
      expect(parsedCsv.rows[0].last_synced).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
      expect(parsedCsv.rows[0].dendron_id).toBeTruthy();

      const page = await fetchPage(parsedCsv.rows[0].notion_url);
      expect(page.properties.Name.title[0].plain_text).toBe(parsedCsv.rows[0].Name);
    } finally {
      workspace.cleanup();
    }
  });

  test('builds csv body in mapping order', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-body-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'body-processor.js'),
        `module.exports = ({ column, value, helper }) => helper.asBody(column + ':' + value);\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-body.yaml'),
        `fnameTrigger: "task.sync-csv-body-*"
mapping:
  - fromName: Name
    toName: Name
  - fromName: Summary
    toType: body
  - fromName: Details
    process: "./body-processor.js"
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const csvPath = writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            Name: `CSV Body ${uniqueSuffix()}`,
            Summary: 'First body fragment',
            Details: 'Second body fragment',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-body', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const parsedCsv = parseCsv(fs.readFileSync(csvPath, 'utf8'));
      const blocks = await listPageChildren(parsedCsv.rows[0].notion_url);
      const blockText = blocks
        .filter((block) => block.type === 'paragraph')
        .map((block) => block.paragraph.rich_text.map((item) => item.plain_text).join(''));

      expect(blockText).toEqual(['First body fragment', '', 'Details:Second body fragment']);
    } finally {
      workspace.cleanup();
    }
  });

  test('re-syncs reordered csv rows without creating duplicates', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-reorder-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-reorder.yaml'),
        `fnameTrigger: "task.sync-csv-reorder-*"
mapping:
  - fromName: Name
    toName: Name
  - fromName: Status
    toName: Status
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );

      const firstRows = [
        { Name: `CSV Reorder A ${uniqueSuffix()}`, Status: 'Not started' },
        { Name: `CSV Reorder B ${uniqueSuffix()}`, Status: 'In Progress' },
      ];
      const csvPath = writeCsv({ root: workspace.root, fname: csvName, rows: firstRows });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-reorder', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const firstSyncRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      const urlsByName = Object.fromEntries(firstSyncRows.map((row) => [row.Name, row.notion_url]));

      const reorderedRows = [
        { Name: firstRows[1].Name, Status: firstRows[1].Status },
        { Name: firstRows[0].Name, Status: firstRows[0].Status },
      ];
      writeCsv({ root: workspace.root, fname: csvName, rows: reorderedRows });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-reorder', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const secondSyncRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      expect(secondSyncRows).toHaveLength(2);
      secondSyncRows.forEach((row) => {
        expect(row.notion_url).toBe(urlsByName[row.Name]);
      });
    } finally {
      workspace.cleanup();
    }
  });

  test('uploads file/image blocks from csv processors', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-file-${uniqueSuffix()}`;
      const imagePath = writeTinyPng(path.join(workspace.root, 'tiny.png'));
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'file-processor.js'),
        `module.exports = ({ value, helper }) => helper.uploadFile(value);\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-file.yaml'),
        `fnameTrigger: "task.sync-csv-file-*"
mapping:
  - fromName: Name
    toName: Name
  - fromName: ImagePath
    process: "./file-processor.js"
    toType: file/image
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const csvPath = writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            Name: `CSV File ${uniqueSuffix()}`,
            ImagePath: imagePath,
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-file', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const parsedCsv = parseCsv(fs.readFileSync(csvPath, 'utf8'));
      const blocks = await listPageChildren(parsedCsv.rows[0].notion_url);
      expect(blocks.some((block) => block.type === 'image')).toBe(true);
    } finally {
      workspace.cleanup();
    }
  });

  test('falls back to dendron_id when notion_url is missing on csv re-sync', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-fallback-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-fallback.yaml'),
        `fnameTrigger: "task.sync-csv-fallback-*"
mapping:
  - fromName: Name
    toName: Name
  - fromName: Status
    toName: Status
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const csvPath = writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            Name: `CSV Fallback ${uniqueSuffix()}`,
            Status: 'Not started',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-fallback', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const firstSyncRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      const originalUrl = firstSyncRows[0].notion_url;
      const preservedId = firstSyncRows[0].dendron_id;

      writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            Name: firstSyncRows[0].Name,
            Status: 'Done',
            dendron_id: preservedId,
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-fallback', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const secondSyncRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      expect(secondSyncRows[0].notion_url).toBe(originalUrl);
    } finally {
      workspace.cleanup();
    }
  });

  test('uses syncIdColumn as csv identity when configured', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-sync-id-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-sync-id.yaml'),
        `fnameTrigger: "task.sync-csv-sync-id-*"
syncIdColumn: external_id
mapping:
  - fromName: Name
    toName: Name
  - fromName: Status
    toName: Status
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const externalId = `external-${uniqueSuffix()}`;
      const csvPath = writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            external_id: externalId,
            Name: `CSV SyncId ${uniqueSuffix()}`,
            Status: 'Not started',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-sync-id', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const firstSyncRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      const originalUrl = firstSyncRows[0].notion_url;
      expect(firstSyncRows[0].dendron_id).toBe(externalId);

      writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            external_id: externalId,
            Name: firstSyncRows[0].Name,
            Status: 'Done',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-sync-id', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const secondSyncRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      expect(secondSyncRows[0].notion_url).toBe(originalUrl);
      expect(secondSyncRows[0].dendron_id).toBe(externalId);
    } finally {
      workspace.cleanup();
    }
  });

  test('update operation only updates selected columns and skips creates', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-update-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-update.yaml'),
        `fnameTrigger: "task.sync-csv-update-*"
syncIdColumn: external_id
mapping:
  - fromName: Name
    toName: Name
  - fromName: Status
    toName: Status
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const existingId = `external-${uniqueSuffix()}`;
      const missingId = `missing-${uniqueSuffix()}`;
      const originalName = `CSV Update Name ${uniqueSuffix()}`;
      const csvPath = writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            external_id: existingId,
            Name: originalName,
            Status: 'Not started',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-update', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            external_id: existingId,
            Name: `${originalName} changed`,
            Status: 'Done',
          },
          {
            external_id: missingId,
            Name: `New Row ${uniqueSuffix()}`,
            Status: 'In Progress',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-update', '--operation', 'update', '--columns', 'Status', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      expect(rows[0].notion_url).toBeTruthy();
      expect(rows[0].dendron_id).toBe(existingId);
      expect(rows[1].notion_url).toBeFalsy();
      expect(rows[1].dendron_id).toBe(missingId);

      const page = await fetchPage(rows[0].notion_url);
      expect(page.properties.Name.title[0].plain_text).toBe(originalName);
      expect(page.properties.Status.status.name).toBe('Done');
    } finally {
      workspace.cleanup();
    }
  });

  test('update operation respects csv limit', async () => {
    const workspace = createTempWorkspace();

    try {
      const csvName = `task.sync-csv-update-limit-${uniqueSuffix()}`;
      fs.writeFileSync(
        path.join(workspace.syncRulesDir, 'csv-update-limit.yaml'),
        `fnameTrigger: "task.sync-csv-update-limit-*"
syncIdColumn: external_id
mapping:
  - fromName: Name
    toName: Name
  - fromName: Status
    toName: Status
destination:
  kind: db
  id: "${testDatabaseId}"
`,
        'utf8'
      );
      const rows = [
        {
          external_id: `external-a-${uniqueSuffix()}`,
          Name: `Limit A ${uniqueSuffix()}`,
          Status: 'Not started',
        },
        {
          external_id: `external-b-${uniqueSuffix()}`,
          Name: `Limit B ${uniqueSuffix()}`,
          Status: 'Not started',
        },
      ];
      const csvPath = writeCsv({ root: workspace.root, fname: csvName, rows });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-update-limit', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const createdRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      const urlsById = Object.fromEntries(createdRows.map((row) => [row.external_id, row.notion_url]));

      writeCsv({
        root: workspace.root,
        fname: csvName,
        rows: [
          {
            external_id: rows[0].external_id,
            Name: rows[0].Name,
            Status: 'Done',
          },
          {
            external_id: rows[1].external_id,
            Name: rows[1].Name,
            Status: 'In Progress',
          },
        ],
      });

      runSyncCommand({
        cwd: workspace.root,
        args: ['--from', 'csv', '--rule', 'csv-update-limit', '--operation', 'update', '--columns', 'Status', '--limit', '1', csvPath],
        rulesDir: workspace.syncRulesDir,
      });

      const updatedRows = parseCsv(fs.readFileSync(csvPath, 'utf8')).rows;
      const firstPage = await fetchPage(urlsById[rows[0].external_id]);
      const secondPage = await fetchPage(urlsById[rows[1].external_id]);

      expect(updatedRows[0].notion_url).toBe(urlsById[rows[0].external_id]);
      expect(updatedRows[1].notion_url).toBeFalsy();
      expect(firstPage.properties.Status.status.name).toBe('Done');
      expect(secondPage.properties.Status.status.name).toBe('Not started');
    } finally {
      workspace.cleanup();
    }
  });

  test('requires --from in non-interactive mode', () => {
    const workspace = createTempWorkspace();

    try {
      const result = spawnSync('node', [notionCliPath, 'sync', '--rules-dir', workspace.syncRulesDir], {
        cwd: workspace.root,
        env: { ...process.env },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Missing required --from option/);
    } finally {
      workspace.cleanup();
    }
  });
});
