const { Client } = require('@notionhq/client');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { loadEnv, coerceValueForPropertyType, markdownToParagraphBlocks, normalizeNotionId } = require('../utils');

const execFileAsync = promisify(execFile);

process.env.NODE_ENV = 'test';

try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

describe('Lookup Command Integration Tests', () => {
  let client;
  let testDatabaseId;
  let titlePropName;
  let testTitle;
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

    testTitle = `Lookup Integ ${Date.now()}`;

    const page = await client.pages.create({
      parent: { database_id: testDatabaseId },
      properties: {
        [titlePropName]: coerceValueForPropertyType('title', testTitle),
      },
      children: markdownToParagraphBlocks('Lookup integration body line'),
    });

    testPageId = page.id;

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 20000);

  afterAll(async () => {
    if (!testPageId) return;
    try {
      await client.pages.update({ page_id: testPageId, archived: true });
    } catch (err) {
      // Best-effort cleanup
    }
  });

  async function runLookup(args) {
    const scriptPath = path.join(__dirname, '..', 'notion.js');
    const cwd = path.join(__dirname, '..');
    const env = { ...process.env, NODE_ENV: 'test' };

    const { stdout } = await execFileAsync('node', [scriptPath, 'lookup', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });

    return stdout.trim();
  }

  async function findSeededResultWithRetry({
    attempts = 10,
    delayMs = 2000,
  } = {}) {
    let lastResults = [];

    for (let i = 0; i < attempts; i++) {
      const stdout = await runLookup([
        'Lookup Integ',
        '--filter',
        'object:page',
        '--sort',
        'last_edited_time:descending',
        '--limit',
        '50',
      ]);
      const results = JSON.parse(stdout);
      lastResults = results;

      const matched = results.find((item) => item.id === testPageId);
      if (matched) {
        return matched;
      }

      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const sample = lastResults.slice(0, 3);
    throw new Error(
      `Seeded page was not returned by lookup query after ${attempts} attempts. ` +
        `Sample result IDs: ${sample.map((item) => item.id).join(', ')}`
    );
  }

  test('finds seeded page by query', async () => {
    const matched = await findSeededResultWithRetry();
    expect(matched.object).toBe('page');
    expect(matched.title).toContain('Lookup Integ');
  }, 60000);

  test('supports object filter and sort options', async () => {
    const stdout = await runLookup([
      'Lookup Integ',
      '--filter',
      'object:page',
      '--sort',
      'last_edited_time:descending',
      '--limit',
      '10',
    ]);

    const results = JSON.parse(stdout);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((item) => item.object === 'page')).toBe(true);
  }, 20000);
});
