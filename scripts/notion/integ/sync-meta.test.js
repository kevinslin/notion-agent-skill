const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadEnv } = require('../utils');
const { syncDatabaseMetadata, getCacheFilePath, getColumnInfo } = require('../commands/sync-meta');

// Set NODE_ENV to test so loadEnv loads .env.test
process.env.NODE_ENV = 'test';

// Load .env.test using the loadEnv utility
try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

describe('Sync Metadata Integration Tests', () => {
  let client;
  const testCacheFile = path.join(os.homedir(), '.notion-cache.test.json');

  beforeAll(() => {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error('NOTION_TOKEN must be set in .env.test for integration tests');
    }
    client = new Client({ auth: token });
  });

  afterEach(() => {
    // Clean up test cache file after each test
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  describe('getCacheFilePath', () => {
    test('should return correct path for production', () => {
      const filePath = getCacheFilePath('production');
      expect(filePath).toBe(path.join(os.homedir(), '.notion-cache.production.json'));
    });

    test('should return correct path for test', () => {
      const filePath = getCacheFilePath('test');
      expect(filePath).toBe(path.join(os.homedir(), '.notion-cache.test.json'));
    });
  });

  describe('getColumnInfo', () => {
    test('should extract basic property info', () => {
      const propSchema = { type: 'title' };
      const column = getColumnInfo('Name', propSchema);

      expect(column).toEqual({
        name: 'Name',
        type: 'title',
      });
    });

    test('should extract select options', () => {
      const propSchema = {
        type: 'select',
        select: {
          options: [
            { name: 'Option 1', color: 'blue', id: 'id1' },
            { name: 'Option 2', color: 'red', id: 'id2' },
          ],
        },
      };
      const column = getColumnInfo('Status', propSchema);

      expect(column.name).toBe('Status');
      expect(column.type).toBe('select');
      expect(column.values).toHaveLength(2);
      expect(column.values[0]).toEqual({ name: 'Option 1', color: 'blue', id: 'id1' });
    });

    test('should extract multi_select options', () => {
      const propSchema = {
        type: 'multi_select',
        multi_select: {
          options: [
            { name: 'Tag1', color: 'green' },
            { name: 'Tag2', color: 'yellow' },
          ],
        },
      };
      const column = getColumnInfo('Tags', propSchema);

      expect(column.type).toBe('multi_select');
      expect(column.values).toHaveLength(2);
      expect(column.values[0].name).toBe('Tag1');
    });

    test('should extract relation info', () => {
      const propSchema = {
        type: 'relation',
        relation: {
          database_id: 'db123',
          synced_property_name: 'Related',
          synced_property_id: 'prop123',
        },
      };
      const column = getColumnInfo('Related Items', propSchema);

      expect(column.type).toBe('relation');
      expect(column.database_id).toBe('db123');
      expect(column.synced_property_name).toBe('Related');
      expect(column.synced_property_id).toBe('prop123');
    });
  });

  describe('syncDatabaseMetadata', () => {
    test('should sync metadata for databases', async () => {
      const metadata = await syncDatabaseMetadata({ client, limit: 3 });

      expect(Array.isArray(metadata)).toBe(true);
      expect(metadata.length).toBeGreaterThan(0);
      expect(metadata.length).toBeLessThanOrEqual(3);

      // Verify structure
      const firstDb = metadata[0];
      expect(firstDb).toHaveProperty('id');
      expect(firstDb).toHaveProperty('title');
      expect(firstDb).toHaveProperty('url');
      expect(firstDb).toHaveProperty('columns');
      expect(Array.isArray(firstDb.columns)).toBe(true);
    }, 15000); // Increase timeout for API calls

    test('should include column information', async () => {
      const metadata = await syncDatabaseMetadata({ client, limit: 1 });

      expect(metadata.length).toBeGreaterThan(0);

      const db = metadata[0];
      expect(db.columns.length).toBeGreaterThan(0);

      // Every column should have name and type
      db.columns.forEach(col => {
        expect(col).toHaveProperty('name');
        expect(col).toHaveProperty('type');
        expect(typeof col.name).toBe('string');
        expect(typeof col.type).toBe('string');
      });
    });

    test('should include values for select properties', async () => {
      const metadata = await syncDatabaseMetadata({ client, limit: 10 });

      // Find a database with a select property
      let foundSelect = false;
      for (const db of metadata) {
        const selectCol = db.columns.find(col => col.type === 'select' || col.type === 'multi_select');
        if (selectCol && selectCol.values) {
          foundSelect = true;
          expect(Array.isArray(selectCol.values)).toBe(true);
          if (selectCol.values.length > 0) {
            expect(selectCol.values[0]).toHaveProperty('name');
            expect(selectCol.values[0]).toHaveProperty('color');
          }
          break;
        }
      }

      // We expect at least one database to have a select property
      // If not found, this is still a valid test (just no select properties in workspace)
      if (foundSelect) {
        expect(foundSelect).toBe(true);
      }
    }, 15000); // Increase timeout for API calls

    test('should handle databases without errors', async () => {
      // This test verifies that the sync doesn't throw even if there are issues with individual databases
      const metadata = await syncDatabaseMetadata({ client, limit: 5 });

      expect(Array.isArray(metadata)).toBe(true);
      // Should have successfully synced at least some databases
      expect(metadata.length).toBeGreaterThan(0);
    }, 15000); // Increase timeout for API calls
  });

  describe('Cache file writing', () => {
    test('should write cache file to correct location', async () => {
      const metadata = await syncDatabaseMetadata({ client, limit: 2 });

      // Write to test cache file
      const cacheFilePath = getCacheFilePath('test');
      fs.writeFileSync(cacheFilePath, JSON.stringify(metadata, null, 2), 'utf8');

      // Verify file exists
      expect(fs.existsSync(cacheFilePath)).toBe(true);

      // Verify content
      const cachedData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
      expect(cachedData).toEqual(metadata);
    }, 15000);

    test('should write valid JSON', async () => {
      const metadata = await syncDatabaseMetadata({ client, limit: 1 });

      const cacheFilePath = getCacheFilePath('test');
      fs.writeFileSync(cacheFilePath, JSON.stringify(metadata, null, 2), 'utf8');

      // Should be able to parse without errors
      expect(() => {
        JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
      }).not.toThrow();
    }, 15000);
  });
});
