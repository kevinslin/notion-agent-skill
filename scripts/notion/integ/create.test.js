const { Client } = require('@notionhq/client');
const path = require('path');
const fs = require('fs');
const createCommand = require('../commands/create');
const { loadEnv } = require('../utils');

// Set NODE_ENV to test so loadEnv loads .env.test
process.env.NODE_ENV = 'test';

// Load .env.test using the loadEnv utility
try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

describe('Create Command Integration Tests', () => {
  let client;
  let testDatabaseId;

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

  // Helper to extract handler logic for testing
  const createPage = async (params) => {
    // Import the internal createPage function by accessing it directly
    const { Client } = require('@notionhq/client');
    const { coerceValueForPropertyType, markdownToParagraphBlocks } = require('../utils');

    const { client, databaseId, properties, body } = params;

    // Fetch database to learn property types
    const db = await client.databases.retrieve({ database_id: databaseId });

    const propNameToType = {};
    for (const [propName, schema] of Object.entries(db.properties)) {
      propNameToType[propName] = schema.type;
    }

    // Build properties with type coercion
    const coercedProperties = {};
    for (const [key, value] of Object.entries(properties)) {
      const type = propNameToType[key];
      if (!type) {
        throw new Error(`Property "${key}" not found in database schema. Available properties: ${Object.keys(propNameToType).join(', ')}`);
      }
      coercedProperties[key] = coerceValueForPropertyType(type, value);
    }

    // Ensure title property exists; if not provided, set blank title on first title property
    const titleEntry = Object.entries(db.properties).find(([, s]) => s.type === 'title');
    if (!titleEntry) {
      throw new Error('Database is missing a title property.');
    }
    const [titlePropName] = titleEntry;
    if (coercedProperties[titlePropName] === undefined) {
      coercedProperties[titlePropName] = coerceValueForPropertyType('title', '');
    }

    // Convert body to Notion blocks
    const children = markdownToParagraphBlocks(body || '');

    // Create the page
    const page = await client.pages.create({
      parent: { database_id: databaseId },
      properties: coercedProperties,
      children,
    });

    return page;
  };

  describe('Basic page creation', () => {
    test('should create a page with title property', async () => {
      const properties = {
        Name: 'Test Page ' + Date.now(),
      };

      const page = await createPage({
        client,
        databaseId: testDatabaseId,
        properties,
        body: null,
      });

      expect(page).toBeDefined();
      expect(page.id).toBeDefined();
      expect(page.url).toBeDefined();
      expect(page.properties.Name).toBeDefined();
    });

    test('should create a page with raw markdown body', async () => {
      const properties = {
        Name: 'Test Page with Body ' + Date.now(),
      };

      const body = 'This is a test page.\nWith multiple lines.\nAnd some content.';

      const page = await createPage({
        client,
        databaseId: testDatabaseId,
        properties,
        body,
      });

      expect(page).toBeDefined();
      expect(page.id).toBeDefined();
      expect(page.url).toBeDefined();
    }, 15000); // Increase timeout to 15 seconds

    test('should create a page with multiple properties', async () => {
      // Note: Adjust property names based on your test database schema
      const properties = {
        Name: 'Test Page with Multiple Props ' + Date.now(),
        // Add more properties based on your test database
        // Date: '2025-12-14',
        // Tags: 'test,integration',
      };

      const page = await createPage({
        client,
        databaseId: testDatabaseId,
        properties,
        body: 'Test content',
      });

      expect(page).toBeDefined();
      expect(page.id).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('should throw error for invalid database ID', async () => {
      const properties = {
        Name: 'Test Page',
      };

      await expect(
        createPage({
          client,
          databaseId: 'invalid-id',
          properties,
          body: null,
        })
      ).rejects.toThrow();
    });

    test('should throw error for invalid property name', async () => {

      const properties = {
        InvalidPropertyName: 'value',
      };

      await expect(
        createPage({
          client,
          databaseId: testDatabaseId,
          properties,
          body: null,
        })
      ).rejects.toThrow(/Property.*not found in database schema/);
    });
  });

  describe('Body from text file', () => {
    test('should create a page with body from text file', async () => {
      // Create a temporary test file
      const { parseBodyInput } = require('../utils');
      const testFilePath = path.join(__dirname, 'test-temp.md');
      const testContent = 'This is content from a file.\nLine 2\nLine 3';
      fs.writeFileSync(testFilePath, testContent);

      try {
        const { content } = parseBodyInput(testFilePath);

        const properties = {
          Name: 'Test Page from File ' + Date.now(),
        };

        const page = await createPage({
          client,
          databaseId: testDatabaseId,
          properties,
          body: content,
        });

        expect(page).toBeDefined();
        expect(page.id).toBeDefined();
      } finally {
        // Cleanup
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    });
  });
});
