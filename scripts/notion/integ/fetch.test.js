const { Client } = require('@notionhq/client');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { loadEnv, coerceValueForPropertyType, markdownToParagraphBlocks, normalizeNotionId } = require('../utils');

const execFileAsync = promisify(execFile);

// Set NODE_ENV to test so loadEnv loads .env.test
process.env.NODE_ENV = 'test';

// Load .env.test using the loadEnv utility
try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

describe('Fetch Command Integration Tests', () => {
  let client;
  let testDatabaseId;
  let titlePropName;
  let testTitle;
  let testBodyLine;
  let testPageId;

  beforeAll(async () => {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error('NOTION_TOKEN must be set in .env.test for integration tests');
    }

    client = new Client({ auth: token });

    const rawTestDatabaseId = process.env.TEST_DATABASE_ID;
    testDatabaseId = normalizeNotionId(rawTestDatabaseId) || rawTestDatabaseId;
    if (!testDatabaseId) {
      throw new Error('TEST_DATABASE_ID not set in .env.test');
    }

    const db = await client.databases.retrieve({ database_id: testDatabaseId });
    const titleEntry = Object.entries(db.properties || {}).find(([, schema]) => schema.type === 'title');
    if (!titleEntry) {
      throw new Error('Test database is missing a title property');
    }
    titlePropName = titleEntry[0];

    testTitle = `Fetch Integ ${Date.now()}`;
    testBodyLine = 'Fetch integration body line';

    const children = markdownToParagraphBlocks(testBodyLine);

    const page = await client.pages.create({
      parent: { database_id: testDatabaseId },
      properties: {
        [titlePropName]: coerceValueForPropertyType('title', testTitle),
      },
      children,
    });

    testPageId = page.id;

    // Give Notion time to index the page for queries
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 20000);

  afterAll(async () => {
    if (!testPageId) return;
    try {
      await client.pages.update({ page_id: testPageId, archived: true });
    } catch (err) {
      // Best-effort cleanup; don't fail tests on cleanup issues.
    }
  });

  async function runFetch(args) {
    const scriptPath = path.join(__dirname, '..', 'notion.js');
    const cwd = path.join(__dirname, '..');
    const env = { ...process.env, NODE_ENV: 'test' };

    const { stdout } = await execFileAsync('node', [scriptPath, 'fetch', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });

    return stdout.trim();
  }

  function normalizeMarkdown(output) {
    return output
      .replaceAll(testTitle, '<TITLE>')
      .replaceAll(testPageId, '<ID>')
      .replace(/https?:\/\/\\S+/g, '<URL>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
  }

  test('fetches pages by query (json)', async () => {
    const stdout = await runFetch([
      '--database-id',
      testDatabaseId,
      '--query',
      testTitle,
      '--limit',
      '5',
    ]);

    const results = JSON.parse(stdout);
    const matches = results.filter((page) => page.id === testPageId);
    expect(matches).toHaveLength(1);

    const normalized = matches.map(({ id, title, ...rest }) => ({
      ...rest,
      title: '<TITLE>',
    }));
    expect(normalized).toMatchSnapshot();
  }, 20000);

  test('renders markdown output', async () => {
    const stdout = await runFetch([
      '--database-id',
      testDatabaseId,
      '--query',
      testTitle,
      '--output',
      'md',
      '--limit',
      '5',
    ]);

    const normalized = normalizeMarkdown(stdout);
    expect(normalized).toMatchSnapshot();
  }, 20000);
});
