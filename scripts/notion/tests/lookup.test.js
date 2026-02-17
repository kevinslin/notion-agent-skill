const {
  normalizeSortDirection,
  parseLookupSort,
  normalizeLookupFilterValue,
  parseLookupFilter,
  getPageTitle,
  getDatabaseTitle,
  summarizeParent,
  normalizeSearchResult,
  formatLookupTable,
} = require('../commands/lookup');

describe('lookup helpers', () => {
  describe('sort parsing', () => {
    test('normalizes sort directions', () => {
      const result = {
        asc: normalizeSortDirection('asc'),
        desc: normalizeSortDirection('desc'),
        ascending: normalizeSortDirection('ascending'),
        descending: normalizeSortDirection('descending'),
      };

      expect(result).toMatchSnapshot();
    });

    test('parses valid lookup sort', () => {
      const result = {
        long: parseLookupSort('last_edited_time:descending'),
        short: parseLookupSort('last_edited_time:asc'),
      };

      expect(result).toMatchSnapshot();
    });

    test('rejects invalid sort input', () => {
      expect(() => parseLookupSort('created_time:ascending')).toThrow(
        /Unsupported sort timestamp/
      );
      expect(() => parseLookupSort('last_edited_time')).toThrow(/Invalid --sort syntax/);
    });
  });

  describe('filter parsing', () => {
    test('normalizes object filters', () => {
      const result = {
        page: normalizeLookupFilterValue('page'),
        database: normalizeLookupFilterValue('database'),
        dataSourceAlias: normalizeLookupFilterValue('data_source'),
      };

      expect(result).toMatchSnapshot();
    });

    test('parses valid filter expressions', () => {
      const result = {
        page: parseLookupFilter('object:page'),
        database: parseLookupFilter('object:database'),
      };

      expect(result).toMatchSnapshot();
    });

    test('rejects invalid filter input', () => {
      expect(() => parseLookupFilter('name:page')).toThrow(/Only "object" is supported/);
      expect(() => parseLookupFilter('object')).toThrow(/Invalid --filter syntax/);
      expect(() => parseLookupFilter('object:comment')).toThrow(/Unsupported lookup object filter/);
    });
  });

  describe('result normalization', () => {
    test('extracts page and database titles', () => {
      const page = {
        object: 'page',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Roadmap item' }],
          },
        },
      };

      const database = {
        object: 'database',
        title: [{ plain_text: 'Projects' }],
      };

      const result = {
        pageTitle: getPageTitle(page),
        databaseTitle: getDatabaseTitle(database),
      };

      expect(result).toMatchSnapshot();
    });

    test('summarizes parent references', () => {
      const result = {
        workspace: summarizeParent({ type: 'workspace', workspace: true }),
        page: summarizeParent({ type: 'page_id', page_id: 'page-1' }),
        database: summarizeParent({ type: 'database_id', database_id: 'db-1' }),
      };

      expect(result).toMatchSnapshot();
    });

    test('normalizes mixed search results', () => {
      const pageResult = {
        id: 'page-id',
        object: 'page',
        url: 'https://www.notion.so/page-id',
        last_edited_time: '2026-02-17T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Lookup page' }],
          },
        },
      };

      const databaseResult = {
        id: 'database-id',
        object: 'database',
        url: 'https://www.notion.so/database-id',
        last_edited_time: '2026-02-16T00:00:00.000Z',
        parent: { type: 'page_id', page_id: 'parent-page' },
        title: [{ plain_text: 'Lookup db' }],
      };

      const result = [
        normalizeSearchResult(pageResult),
        normalizeSearchResult(databaseResult),
      ];

      expect(result).toMatchSnapshot();
    });
  });

  describe('table formatting', () => {
    test('formats tabular output', () => {
      const rows = [
        {
          id: '1',
          object: 'page',
          title: 'Lookup page',
          url: 'https://www.notion.so/1',
          last_edited_time: '2026-02-17T00:00:00.000Z',
          parent: { type: 'workspace', workspace: true },
        },
      ];

      const result = formatLookupTable(rows);
      expect(result).toMatchSnapshot();
    });

    test('formats empty result set', () => {
      expect(formatLookupTable([])).toBe('No results.');
    });
  });
});
