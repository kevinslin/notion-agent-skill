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

  const runSyncCommand = ({ cwd, args = [], rulesDir }) => {
    const cliArgs = ['sync'];
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
});
