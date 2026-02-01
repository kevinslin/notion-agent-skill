const { Client } = require('@notionhq/client');
const path = require('path');
const fs = require('fs');
const { parseFilter } = require('../utils');

// Set NODE_ENV to test so loadEnv loads .env.test
process.env.NODE_ENV = 'test';

// Load .env.test using the loadEnv utility
const { loadEnv } = require('../utils');
try {
  loadEnv();
} catch (err) {
  throw new Error(`Failed to load .env.test: ${err.message}`);
}

describe('Filter Integration Tests', () => {
  let client;
  let testDatabaseId;
  let databaseSchema;

  beforeAll(async () => {
    const token = process.env.NOTION_TOKEN;
    if (!token) {
      throw new Error('NOTION_TOKEN must be set in .env.test for integration tests');
    }

    client = new Client({ auth: token });

    testDatabaseId = process.env.TEST_DATABASE_ID;
    if (!testDatabaseId) {
      throw new Error('TEST_DATABASE_ID not set in .env.test');
    }

    // Fetch database schema
    const db = await client.databases.retrieve({ database_id: testDatabaseId });
    databaseSchema = {};
    for (const [propName, schema] of Object.entries(db.properties)) {
      databaseSchema[propName] = schema.type;
    }

    console.log('Database schema:', databaseSchema);
  });

  describe('parseFilter with database schema', () => {
    test('parses simple text filter', () => {
      const filter = parseFilter('Name:contains:test', databaseSchema);

      expect(filter).toEqual({
        property: 'Name',
        title: {
          contains: 'test',
        },
      });
    });

    test('parses compound AND filter', () => {
      const filter = parseFilter('Name:contains:test AND Name:is_not_empty:true', databaseSchema);

      expect(filter).toHaveProperty('and');
      expect(filter.and).toHaveLength(2);
      expect(filter.and[0]).toEqual({
        property: 'Name',
        title: {
          contains: 'test',
        },
      });
    });

    test('parses compound OR filter', () => {
      const filter = parseFilter('Name:contains:urgent OR Name:contains:important', databaseSchema);

      expect(filter).toHaveProperty('or');
      expect(filter.or).toHaveLength(2);
    });

    test('parses nested filter', () => {
      const filter = parseFilter(
        '(Name:contains:urgent OR Name:contains:important) AND Name:is_not_empty:true',
        databaseSchema
      );

      expect(filter).toHaveProperty('and');
      expect(filter.and).toHaveLength(2);
      expect(filter.and[0]).toHaveProperty('or');
    });

    test('parses timestamp filter', () => {
      const filter = parseFilter('created_time:past_week:true', databaseSchema);

      expect(filter).toEqual({
        timestamp: 'created_time',
        created_time: {
          past_week: {},
        },
      });
    });

    test('throws error for invalid property', () => {
      expect(() => {
        parseFilter('InvalidProperty:equals:value', databaseSchema);
      }).toThrow(/Property "InvalidProperty" not found/);
    });

    test('throws error for invalid operator', () => {
      // Assuming Name is a title property, contains is valid
      // But if we try to use an invalid operator like greater_than
      expect(() => {
        parseFilter('Name:greater_than:5', databaseSchema);
      }).toThrow(/Operator "greater_than" is not valid/);
    });
  });

  describe('Query database with filters', () => {
    // Helper function to query with filter
    async function queryWithFilter(filterString) {
      const filter = parseFilter(filterString, databaseSchema);

      const response = await client.databases.query({
        database_id: testDatabaseId,
        filter,
        page_size: 10,
      });

      return response.results;
    }

    test('filters by text contains', async () => {
      // First, let's get all pages to see what we have
      const allPages = await client.databases.query({
        database_id: testDatabaseId,
        page_size: 100,
      });

      if (allPages.results.length === 0) {
        console.log('No pages in test database, skipping filter tests');
        return;
      }

      // Get the first page's title to use in filter
      const firstPage = allPages.results[0];
      const titleProp = Object.entries(firstPage.properties).find(
        ([, prop]) => prop.type === 'title'
      );

      if (!titleProp) {
        console.log('No title property found, skipping test');
        return;
      }

      const [titlePropName, titlePropValue] = titleProp;
      const titleText = titlePropValue.title[0]?.plain_text || '';

      if (!titleText) {
        console.log('Empty title, skipping test');
        return;
      }

      // Extract a substring from the title to search for
      const searchTerm = titleText.substring(0, Math.min(5, titleText.length));

      const results = await queryWithFilter(`${titlePropName}:contains:${searchTerm}`);

      expect(results.length).toBeGreaterThan(0);
      // Verify that all results contain the search term
      results.forEach((page) => {
        const title = page.properties[titlePropName].title[0]?.plain_text || '';
        expect(title.toLowerCase()).toContain(searchTerm.toLowerCase());
      });
    }, 10000);

    test('filters by is_not_empty', async () => {
      const results = await queryWithFilter('Name:is_not_empty:true');

      // All results should have a non-empty Name
      results.forEach((page) => {
        const title = page.properties.Name?.title || [];
        expect(title.length).toBeGreaterThan(0);
      });
    }, 10000);

    test('filters by timestamp (created this week)', async () => {
      const results = await queryWithFilter('created_time:past_week:true');

      // All results should be created in the past week
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      results.forEach((page) => {
        const createdTime = new Date(page.created_time);
        expect(createdTime.getTime()).toBeGreaterThanOrEqual(oneWeekAgo.getTime());
      });
    }, 10000);

    test('filters with AND condition', async () => {
      const results = await queryWithFilter(
        'Name:is_not_empty:true AND created_time:past_month:true'
      );

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      results.forEach((page) => {
        // Check Name is not empty
        const title = page.properties.Name?.title || [];
        expect(title.length).toBeGreaterThan(0);

        // Check created within past month
        const createdTime = new Date(page.created_time);
        expect(createdTime.getTime()).toBeGreaterThanOrEqual(oneMonthAgo.getTime());
      });
    }, 10000);

    test('filters with OR condition', async () => {
      // This will match pages created in the past week OR past month (so effectively past month)
      const results = await queryWithFilter(
        'created_time:past_week:true OR created_time:past_month:true'
      );

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      results.forEach((page) => {
        const createdTime = new Date(page.created_time);
        expect(createdTime.getTime()).toBeGreaterThanOrEqual(oneMonthAgo.getTime());
      });
    }, 10000);

    test('filters with nested conditions', async () => {
      // (created_time:past_week OR created_time:past_month) AND Name:is_not_empty
      const results = await queryWithFilter(
        '(created_time:past_week:true OR created_time:past_month:true) AND Name:is_not_empty:true'
      );

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      results.forEach((page) => {
        // Check Name is not empty
        const title = page.properties.Name?.title || [];
        expect(title.length).toBeGreaterThan(0);

        // Check created within timeframe
        const createdTime = new Date(page.created_time);
        expect(createdTime.getTime()).toBeGreaterThanOrEqual(oneMonthAgo.getTime());
      });
    }, 10000);
  });

  describe('Property type specific filters', () => {
    test('handles checkbox property if available', async () => {
      const checkboxProps = Object.entries(databaseSchema).filter(
        ([, type]) => type === 'checkbox'
      );

      if (checkboxProps.length === 0) {
        console.log('No checkbox properties in database, skipping test');
        return;
      }

      const [checkboxPropName] = checkboxProps[0];
      const filter = parseFilter(`${checkboxPropName}:equals:true`, databaseSchema);

      expect(filter).toEqual({
        property: checkboxPropName,
        checkbox: {
          equals: true,
        },
      });
    });

    test('handles number property if available', async () => {
      const numberProps = Object.entries(databaseSchema).filter(
        ([, type]) => type === 'number'
      );

      if (numberProps.length === 0) {
        console.log('No number properties in database, skipping test');
        return;
      }

      const [numberPropName] = numberProps[0];
      const filter = parseFilter(`${numberPropName}:greater_than:0`, databaseSchema);

      expect(filter).toEqual({
        property: numberPropName,
        number: {
          greater_than: 0,
        },
      });
    });

    test('handles select property if available', async () => {
      const selectProps = Object.entries(databaseSchema).filter(
        ([, type]) => type === 'select'
      );

      if (selectProps.length === 0) {
        console.log('No select properties in database, skipping test');
        return;
      }

      const [selectPropName] = selectProps[0];
      const filter = parseFilter(`${selectPropName}:is_not_empty:true`, databaseSchema);

      expect(filter).toEqual({
        property: selectPropName,
        select: {
          is_not_empty: true,
        },
      });
    });

    test('handles multi_select property if available', async () => {
      const multiSelectProps = Object.entries(databaseSchema).filter(
        ([, type]) => type === 'multi_select'
      );

      if (multiSelectProps.length === 0) {
        console.log('No multi_select properties in database, skipping test');
        return;
      }

      const [multiSelectPropName] = multiSelectProps[0];
      const filter = parseFilter(`${multiSelectPropName}:is_not_empty:true`, databaseSchema);

      expect(filter).toEqual({
        property: multiSelectPropName,
        multi_select: {
          is_not_empty: true,
        },
      });
    });

    test('handles date property if available', async () => {
      const dateProps = Object.entries(databaseSchema).filter(
        ([, type]) => type === 'date'
      );

      if (dateProps.length === 0) {
        console.log('No date properties in database, skipping test');
        return;
      }

      const [datePropName] = dateProps[0];
      const filter = parseFilter(`${datePropName}:is_not_empty:true`, databaseSchema);

      expect(filter).toEqual({
        property: datePropName,
        date: {
          is_not_empty: true,
        },
      });
    });

    test('handles status property if available', async () => {
      const statusProps = Object.entries(databaseSchema).filter(
        ([, type]) => type === 'status'
      );

      if (statusProps.length === 0) {
        console.log('No status properties in database, skipping test');
        return;
      }

      const [statusPropName] = statusProps[0];
      const filter = parseFilter(`${statusPropName}:is_not_empty:true`, databaseSchema);

      expect(filter).toEqual({
        property: statusPropName,
        status: {
          is_not_empty: true,
        },
      });
    });
  });

  describe('Complex filter scenarios', () => {
    test('handles quoted values with spaces', async () => {
      const filter = parseFilter('Name:contains:"Test Page"', databaseSchema);

      expect(filter).toEqual({
        property: 'Name',
        title: {
          contains: 'Test Page',
        },
      });
    });

    test('handles multiple AND conditions', async () => {
      const filter = parseFilter(
        'Name:is_not_empty:true AND created_time:past_week:true AND last_edited_time:past_week:true',
        databaseSchema
      );

      expect(filter).toHaveProperty('and');
      expect(filter.and).toHaveLength(3);
    });

    test('handles multiple OR conditions', async () => {
      const filter = parseFilter(
        'created_time:past_week:true OR created_time:past_month:true OR created_time:past_year:true',
        databaseSchema
      );

      expect(filter).toHaveProperty('or');
      expect(filter.or).toHaveLength(3);
    });

    test('handles complex nested filters', async () => {
      const filter = parseFilter(
        '((Name:contains:urgent OR Name:contains:important) AND created_time:past_week:true) OR last_edited_time:past_week:true',
        databaseSchema
      );

      // Should have top-level OR
      expect(filter).toHaveProperty('or');
      expect(filter.or).toHaveLength(2);

      // First OR operand should be AND
      expect(filter.or[0]).toHaveProperty('and');

      // First AND operand should be OR
      expect(filter.or[0].and[0]).toHaveProperty('or');
    });

    test('handles different timestamp operators', async () => {
      const filters = [
        'created_time:past_week:true',
        'created_time:past_month:true',
        'created_time:past_year:true',
        'last_edited_time:past_week:true',
      ];

      filters.forEach((filterStr) => {
        const filter = parseFilter(filterStr, databaseSchema);
        expect(filter).toHaveProperty('timestamp');
      });
    });

    test('handles is_empty and is_not_empty operators', async () => {
      const emptyFilter = parseFilter('Name:is_empty:true', databaseSchema);
      expect(emptyFilter.title.is_empty).toEqual(true);

      const notEmptyFilter = parseFilter('Name:is_not_empty:true', databaseSchema);
      expect(notEmptyFilter.title.is_not_empty).toEqual(true);
    });
  });

  describe('Error handling in real scenarios', () => {
    test('provides helpful error for non-existent property', () => {
      expect(() => {
        parseFilter('NonExistentProperty:equals:value', databaseSchema);
      }).toThrow(/Property "NonExistentProperty" not found in database schema/);
    });

    test('provides helpful error for invalid operator on property type', () => {
      // Try to use a number operator on a text property
      expect(() => {
        parseFilter('Name:greater_than:5', databaseSchema);
      }).toThrow(/Operator "greater_than" is not valid for property "Name"/);
    });

    test('handles empty filter string gracefully', () => {
      const filter = parseFilter('', databaseSchema);
      expect(filter).toBeNull();
    });

    test('handles whitespace-only filter string', () => {
      const filter = parseFilter('   ', databaseSchema);
      expect(filter).toBeNull();
    });
  });
});
