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

      expect(simplifyPropertyValue(titleProp)).toBe('Hello');
      expect(simplifyPropertyValue(richProp)).toBe('World');
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

      expect(simplifyPropertyValue(selectProp)).toBe('High');
      expect(simplifyPropertyValue(multiSelectProp)).toEqual(['A', 'B']);
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

      expect(simplifyPropertyValue(dateProp)).toBe('2026-02-01');
      expect(simplifyPropertyValue(dateRangeProp)).toEqual({
        start: '2026-02-01',
        end: '2026-02-02',
      });
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

      expect(simplifyPropertyValue(filesProp)).toEqual([
        { name: 'spec.pdf', url: 'https://example.com/spec.pdf' },
      ]);
    });
  });

  describe('simplifyProperties', () => {
    test('excludes title property', () => {
      const props = {
        Name: { type: 'title', title: [{ plain_text: 'Task' }] },
        Status: { type: 'select', select: { name: 'Done' } },
      };

      expect(simplifyProperties(props, 'Name')).toEqual({
        Status: 'Done',
      });
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

      expect(blockToMarkdown(paragraph)).toBe('Hello');
      expect(blockToMarkdown(heading)).toBe('## Title');
      expect(blockToMarkdown(todo)).toBe('- [x] Do it');
      expect(blockToMarkdown(code)).toBe('```javascript\nconsole.log(1);\n```');
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

      expect(blocksToBody(blocks)).toBe('Line 1\nLine 2');
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
      expect(combined).toEqual({
        and: [
          { property: 'Status', status: { equals: 'Done' } },
          { property: 'Name', title: { contains: 'urgent' } },
        ],
      });
      expect(getFilterDepth(combined)).toBe(1);
    });
  });
});
