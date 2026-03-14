const { Client } = require('@notionhq/client');
const { loadEnv } = require('../utils');
const { listDatabases } = require('../commands/list-db');

// Set NODE_ENV to test so loadEnv loads .env.test
process.env.NODE_ENV = 'test';

// Load .env.test using the loadEnv utility
try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

describe('List Databases Integration Tests', () => {
  let client;

  beforeAll(() => {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error('NOTION_TOKEN must be set in .env.test for integration tests');
    }
    client = new Client({ auth: token });
  });

  describe('listDatabases', () => {
    test('should return an array of databases', async () => {
      const databases = await listDatabases({ client, limit: 10 });

      expect(Array.isArray(databases)).toBe(true);
      expect(databases.length).toBeGreaterThan(0);
    });

    test('should return databases with id, title, and url', async () => {
      const databases = await listDatabases({ client, limit: 5 });

      expect(databases.length).toBeGreaterThan(0);

      const firstDb = databases[0];
      expect(firstDb).toHaveProperty('id');
      expect(firstDb).toHaveProperty('title');
      expect(firstDb).toHaveProperty('url');

      expect(typeof firstDb.id).toBe('string');
      expect(typeof firstDb.title).toBe('string');
      expect(typeof firstDb.url).toBe('string');

      // Verify ID is a valid UUID format
      expect(firstDb.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Verify URL is a valid Notion URL
      expect(firstDb.url).toMatch(/^https:\/\/www\.notion\.so\//);
    });

    test('should respect the limit parameter', async () => {
      const limit = 3;
      const databases = await listDatabases({ client, limit });

      expect(databases.length).toBeLessThanOrEqual(limit);
    });

    test('should return databases with default limit', async () => {
      const databases = await listDatabases({ client });

      expect(Array.isArray(databases)).toBe(true);
      // Default limit is 100, so should get all available databases up to 100
      expect(databases.length).toBeGreaterThan(0);
    });

    test('should handle pagination correctly', async () => {
      // Get first batch
      const firstBatch = await listDatabases({ client, limit: 5 });

      // Get larger batch
      const largerBatch = await listDatabases({ client, limit: 20 });

      expect(largerBatch.length).toBeGreaterThanOrEqual(firstBatch.length);

      // Verify first batch items are in larger batch
      const largerBatchIds = largerBatch.map(db => db.id);
      firstBatch.forEach(db => {
        expect(largerBatchIds).toContain(db.id);
      });
    });

    test('should handle untitled databases', async () => {
      const databases = await listDatabases({ client, limit: 50 });

      // All databases should have a title (even if it's "Untitled")
      databases.forEach(db => {
        expect(db.title).toBeDefined();
        expect(typeof db.title).toBe('string');
        expect(db.title.length).toBeGreaterThan(0);
      });
    });
  });
});
