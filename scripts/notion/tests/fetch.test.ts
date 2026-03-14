const {
  simplifyPropertyValue,
  simplifyProperties,
  blockToMarkdown,
  blocksToBody,
  combineFilters,
  getFilterDepth,
} = require('../commands/fetch');

describe('fetch helpers', () => {
  describe('simplifyPropertyValue', () => {
    test('handles title and rich_text', () => {
      const titleProp = {
        type: 'title',
        title: [{ plain_text: 'Hello' }],
      };
      const richProp = {
        type: 'rich_text',
        rich_text: [{ plain_text: 'World' }],
      };

      const result = {
        title: simplifyPropertyValue(titleProp),
        rich: simplifyPropertyValue(richProp),
      };

      expect(result).toMatchSnapshot();
    });

    test('handles select and multi_select', () => {
      const selectProp = {
        type: 'select',
        select: { name: 'High' },
      };
      const multiSelectProp = {
        type: 'multi_select',
        multi_select: [{ name: 'A' }, { name: 'B' }],
      };

      const result = {
        select: simplifyPropertyValue(selectProp),
        multiSelect: simplifyPropertyValue(multiSelectProp),
      };

      expect(result).toMatchSnapshot();
    });

    test('handles dates', () => {
      const dateProp = {
        type: 'date',
        date: { start: '2026-02-01' },
      };
      const dateRangeProp = {
        type: 'date',
        date: { start: '2026-02-01', end: '2026-02-02' },
      };

      const result = {
        date: simplifyPropertyValue(dateProp),
        dateRange: simplifyPropertyValue(dateRangeProp),
      };

      expect(result).toMatchSnapshot();
    });

    test('handles files', () => {
      const filesProp = {
        type: 'files',
        files: [
          {
            name: 'spec.pdf',
            type: 'external',
            external: { url: 'https://example.com/spec.pdf' },
          },
        ],
      };

      const result = simplifyPropertyValue(filesProp);

      expect(result).toMatchSnapshot();
    });
  });

  describe('simplifyProperties', () => {
    test('excludes title property', () => {
      const props = {
        Name: { type: 'title', title: [{ plain_text: 'Task' }] },
        Status: { type: 'select', select: { name: 'Done' } },
      };

      const result = simplifyProperties(props, 'Name');

      expect(result).toMatchSnapshot();
    });
  });

  describe('block formatting', () => {
    test('formats common blocks', () => {
      const paragraph = {
        type: 'paragraph',
        paragraph: { rich_text: [{ plain_text: 'Hello' }] },
      };
      const heading = {
        type: 'heading_2',
        heading_2: { rich_text: [{ plain_text: 'Title' }] },
      };
      const todo = {
        type: 'to_do',
        to_do: { rich_text: [{ plain_text: 'Do it' }], checked: true },
      };
      const code = {
        type: 'code',
        code: {
          language: 'javascript',
          rich_text: [{ plain_text: 'console.log(1);' }],
        },
      };

      const result = {
        paragraph: blockToMarkdown(paragraph),
        heading: blockToMarkdown(heading),
        todo: blockToMarkdown(todo),
        code: blockToMarkdown(code),
      };

      expect(result).toMatchSnapshot();
    });

    test('joins blocks into body', () => {
      const blocks = [
        {
          type: 'paragraph',
          paragraph: { rich_text: [{ plain_text: 'Line 1' }] },
        },
        {
          type: 'paragraph',
          paragraph: { rich_text: [{ plain_text: 'Line 2' }] },
        },
      ];

      const result = blocksToBody(blocks);

      expect(result).toMatchSnapshot();
    });
  });

  describe('filter composition', () => {
    test('combines query with AND filter without increasing depth', () => {
      const parsedFilter = {
        and: [
          { property: 'Status', status: { equals: 'Done' } },
        ],
      };
      const queryFilter = {
        property: 'Name',
        title: { contains: 'urgent' },
      };

      const combined = combineFilters(queryFilter, parsedFilter);
      const result = {
        combined,
        depth: getFilterDepth(combined),
      };

      expect(result).toMatchSnapshot();
    });
  });
});
