const { parseFilter, tokenize, FilterParser, astToNotionFilter, validateNestingDepth } = require('../utils/filter');

describe('Filter Parser', () => {
  // Sample schema for testing
  const schema = {
    Name: 'title',
    Description: 'rich_text',
    Status: 'status',
    Priority: 'number',
    Done: 'checkbox',
    Date: 'date',
    Tags: 'multi_select',
    Category: 'select',
    Assignee: 'people',
    RelatedPages: 'relation',
    Attachments: 'files',
  };

  describe('tokenize', () => {
    test('tokenizes simple filter', () => {
      const tokens = tokenize('Name:contains:test');
      expect(tokens).toHaveLength(2); // FILTER + EOF
      expect(tokens[0].type).toBe('FILTER');
      expect(tokens[0].value).toEqual({
        property: 'Name',
        operator: 'contains',
        value: 'test',
      });
    });

    test('tokenizes filter with AND', () => {
      const tokens = tokenize('Name:contains:test AND Status:equals:Done');
      expect(tokens).toHaveLength(4); // FILTER, AND, FILTER, EOF
      expect(tokens[0].type).toBe('FILTER');
      expect(tokens[1].type).toBe('AND');
      expect(tokens[2].type).toBe('FILTER');
    });

    test('tokenizes filter with OR', () => {
      const tokens = tokenize('Status:equals:Done OR Status:equals:Todo');
      expect(tokens).toHaveLength(4); // FILTER, OR, FILTER, EOF
      expect(tokens[1].type).toBe('OR');
    });

    test('tokenizes filter with parentheses', () => {
      const tokens = tokenize('(Name:contains:test OR Name:contains:draft) AND Status:equals:Done');
      expect(tokens[0].type).toBe('LPAREN');
      expect(tokens[tokens.length - 2].type).toBe('FILTER');
      expect(tokens[tokens.length - 1].type).toBe('EOF');
    });

    test('handles quoted values with spaces', () => {
      const tokens = tokenize('Name:contains:"my project"');
      expect(tokens[0].value.value).toBe('my project');
    });

    test('handles single quotes', () => {
      const tokens = tokenize("Name:contains:'my project'");
      expect(tokens[0].value.value).toBe('my project');
    });

    test('handles case-insensitive AND/OR', () => {
      const tokens1 = tokenize('Name:equals:a and Status:equals:b');
      const tokens2 = tokenize('Name:equals:a AND Status:equals:b');
      expect(tokens1[1].type).toBe('AND');
      expect(tokens2[1].type).toBe('AND');

      const tokens3 = tokenize('Name:equals:a or Status:equals:b');
      const tokens4 = tokenize('Name:equals:a OR Status:equals:b');
      expect(tokens3[1].type).toBe('OR');
      expect(tokens4[1].type).toBe('OR');
    });

    test('handles values with colons (timestamps)', () => {
      const tokens = tokenize('Date:after:2025-01-01T00:00:00Z');
      expect(tokens[0].value.value).toBe('2025-01-01T00:00:00Z');
    });
  });

  describe('FilterParser', () => {
    test('parses simple filter', () => {
      const tokens = tokenize('Name:contains:test');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      expect(ast).toEqual({
        type: 'filter',
        property: 'Name',
        operator: 'contains',
        value: 'test',
      });
    });

    test('parses AND expression', () => {
      const tokens = tokenize('Name:contains:test AND Status:equals:Done');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      expect(ast.type).toBe('and');
      expect(ast.filters).toHaveLength(2);
      expect(ast.filters[0].property).toBe('Name');
      expect(ast.filters[1].property).toBe('Status');
    });

    test('parses OR expression', () => {
      const tokens = tokenize('Status:equals:Done OR Status:equals:Todo');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      expect(ast.type).toBe('or');
      expect(ast.filters).toHaveLength(2);
    });

    test('parses nested expression with parentheses', () => {
      const tokens = tokenize('(Name:contains:test OR Name:contains:draft) AND Status:equals:Done');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      expect(ast.type).toBe('and');
      expect(ast.filters).toHaveLength(2);
      expect(ast.filters[0].type).toBe('or');
      expect(ast.filters[0].filters).toHaveLength(2);
    });

    test('handles multiple AND conditions', () => {
      const tokens = tokenize('A:equals:1 AND B:equals:2 AND C:equals:3');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      expect(ast.type).toBe('and');
      expect(ast.filters).toHaveLength(3);
    });

    test('handles multiple OR conditions', () => {
      const tokens = tokenize('A:equals:1 OR B:equals:2 OR C:equals:3');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      expect(ast.type).toBe('or');
      expect(ast.filters).toHaveLength(3);
    });

    test('respects operator precedence (OR before AND)', () => {
      const tokens = tokenize('A:equals:1 OR B:equals:2 AND C:equals:3');
      const parser = new FilterParser(tokens);
      const ast = parser.parse();

      // Should parse as: (A OR B) AND C
      expect(ast.type).toBe('and');
      expect(ast.filters[0].type).toBe('or');
    });

    test('throws on unexpected token', () => {
      const tokens = tokenize('Name:contains:test)');
      const parser = new FilterParser(tokens);
      expect(() => parser.parse()).toThrow(/Unexpected token/);
    });

    test('throws on missing closing parenthesis', () => {
      const tokens = [
        { type: 'LPAREN', value: '(' },
        { type: 'FILTER', value: { property: 'Name', operator: 'equals', value: 'test' } },
        { type: 'EOF', value: null },
      ];
      const parser = new FilterParser(tokens);
      expect(() => parser.parse()).toThrow(/Expected closing parenthesis/);
    });
  });

  describe('astToNotionFilter', () => {
    test('converts simple text filter', () => {
      const ast = {
        type: 'filter',
        property: 'Name',
        operator: 'contains',
        value: 'test',
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        property: 'Name',
        title: {
          contains: 'test',
        },
      });
    });

    test('converts number filter', () => {
      const ast = {
        type: 'filter',
        property: 'Priority',
        operator: 'greater_than',
        value: '5',
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        property: 'Priority',
        number: {
          greater_than: 5,
        },
      });
    });

    test('converts checkbox filter', () => {
      const ast = {
        type: 'filter',
        property: 'Done',
        operator: 'equals',
        value: 'true',
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        property: 'Done',
        checkbox: {
          equals: true,
        },
      });
    });

    test('converts date filter with relative operator', () => {
      const ast = {
        type: 'filter',
        property: 'Date',
        operator: 'past_week',
        value: 'true',
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        property: 'Date',
        date: {
          past_week: {},
        },
      });
    });

    test('converts timestamp filter', () => {
      const ast = {
        type: 'filter',
        property: 'created_time',
        operator: 'after',
        value: '2025-01-01',
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        timestamp: 'created_time',
        created_time: {
          after: '2025-01-01',
        },
      });
    });

    test('converts AND compound filter', () => {
      const ast = {
        type: 'and',
        filters: [
          { type: 'filter', property: 'Name', operator: 'contains', value: 'test' },
          { type: 'filter', property: 'Status', operator: 'equals', value: 'Done' },
        ],
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        and: [
          { property: 'Name', title: { contains: 'test' } },
          { property: 'Status', status: { equals: 'Done' } },
        ],
      });
    });

    test('converts OR compound filter', () => {
      const ast = {
        type: 'or',
        filters: [
          { type: 'filter', property: 'Status', operator: 'equals', value: 'Done' },
          { type: 'filter', property: 'Status', operator: 'equals', value: 'Todo' },
        ],
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        or: [
          { property: 'Status', status: { equals: 'Done' } },
          { property: 'Status', status: { equals: 'Todo' } },
        ],
      });
    });

    test('converts nested filter', () => {
      const ast = {
        type: 'and',
        filters: [
          {
            type: 'or',
            filters: [
              { type: 'filter', property: 'Name', operator: 'contains', value: 'urgent' },
              { type: 'filter', property: 'Priority', operator: 'greater_than', value: '7' },
            ],
          },
          { type: 'filter', property: 'Status', operator: 'equals', value: 'Todo' },
        ],
      };

      const result = astToNotionFilter(ast, schema);
      expect(result).toEqual({
        and: [
          {
            or: [
              { property: 'Name', title: { contains: 'urgent' } },
              { property: 'Priority', number: { greater_than: 7 } },
            ],
          },
          { property: 'Status', status: { equals: 'Todo' } },
        ],
      });
    });

    test('throws error for invalid property', () => {
      const ast = {
        type: 'filter',
        property: 'InvalidProp',
        operator: 'equals',
        value: 'test',
      };

      expect(() => astToNotionFilter(ast, schema)).toThrow(/Property "InvalidProp" not found/);
    });

    test('throws error for invalid operator', () => {
      const ast = {
        type: 'filter',
        property: 'Priority',
        operator: 'contains', // Invalid for number type
        value: '5',
      };

      expect(() => astToNotionFilter(ast, schema)).toThrow(/Operator "contains" is not valid for property "Priority"/);
    });

    test('throws error for invalid number value', () => {
      const ast = {
        type: 'filter',
        property: 'Priority',
        operator: 'equals',
        value: 'not-a-number',
      };

      expect(() => astToNotionFilter(ast, schema)).toThrow(/Invalid number value/);
    });

    test('throws error for invalid checkbox value', () => {
      const ast = {
        type: 'filter',
        property: 'Done',
        operator: 'equals',
        value: 'yes',
      };

      expect(() => astToNotionFilter(ast, schema)).toThrow(/Checkbox value must be "true" or "false"/);
    });
  });

  describe('parseFilter (end-to-end)', () => {
    test('parses and converts simple filter', () => {
      const result = parseFilter('Name:contains:test', schema);
      expect(result).toEqual({
        property: 'Name',
        title: {
          contains: 'test',
        },
      });
    });

    test('parses and converts compound filter', () => {
      const result = parseFilter('Name:contains:test AND Status:equals:Done', schema);
      expect(result).toEqual({
        and: [
          { property: 'Name', title: { contains: 'test' } },
          { property: 'Status', status: { equals: 'Done' } },
        ],
      });
    });

    test('parses and converts nested filter', () => {
      const result = parseFilter('(Name:contains:urgent OR Priority:greater_than:7) AND Status:equals:Todo', schema);
      expect(result).toEqual({
        and: [
          {
            or: [
              { property: 'Name', title: { contains: 'urgent' } },
              { property: 'Priority', number: { greater_than: 7 } },
            ],
          },
          { property: 'Status', status: { equals: 'Todo' } },
        ],
      });
    });

    test('handles quoted values', () => {
      const result = parseFilter('Name:contains:"my project"', schema);
      expect(result.property).toBe('Name');
      expect(result.title.contains).toBe('my project');
    });

    test('handles timestamp filters', () => {
      const result = parseFilter('created_time:past_week:true', schema);
      expect(result).toEqual({
        timestamp: 'created_time',
        created_time: {
          past_week: {},
        },
      });
    });

    test('handles empty filter string', () => {
      expect(parseFilter('', schema)).toBeNull();
      expect(parseFilter('  ', schema)).toBeNull();
      expect(parseFilter(null, schema)).toBeNull();
    });

    test('handles is_empty operators', () => {
      const result = parseFilter('Attachments:is_empty:true', schema);
      expect(result).toEqual({
        property: 'Attachments',
        files: {
          is_empty: true,
        },
      });
    });

    test('handles multi-select contains', () => {
      const result = parseFilter('Tags:contains:urgent', schema);
      expect(result).toEqual({
        property: 'Tags',
        multi_select: {
          contains: 'urgent',
        },
      });
    });

    test('handles complex nested filter', () => {
      const result = parseFilter(
        'created_time:past_week:true AND (Tags:contains:urgent OR Priority:greater_than:7) AND Status:does_not_equal:Archived',
        schema
      );

      expect(result.and).toHaveLength(3);
      expect(result.and[0]).toEqual({
        timestamp: 'created_time',
        created_time: { past_week: {} },
      });
      expect(result.and[1].or).toHaveLength(2);
      expect(result.and[2]).toEqual({
        property: 'Status',
        status: { does_not_equal: 'Archived' },
      });
    });
  });

  describe('validateNestingDepth', () => {
    test('allows single level nesting', () => {
      const ast = {
        type: 'and',
        filters: [
          { type: 'filter', property: 'Name', operator: 'equals', value: 'test' },
          { type: 'filter', property: 'Status', operator: 'equals', value: 'Done' },
        ],
      };
      expect(() => validateNestingDepth(ast)).not.toThrow();
    });

    test('allows two level nesting', () => {
      const ast = {
        type: 'and',
        filters: [
          {
            type: 'or',
            filters: [
              { type: 'filter', property: 'A', operator: 'equals', value: '1' },
              { type: 'filter', property: 'B', operator: 'equals', value: '2' },
            ],
          },
          { type: 'filter', property: 'C', operator: 'equals', value: '3' },
        ],
      };
      expect(() => validateNestingDepth(ast)).not.toThrow();
    });

    test('throws on three level nesting', () => {
      const ast = {
        type: 'and',
        filters: [
          {
            type: 'or',
            filters: [
              {
                type: 'and',
                filters: [
                  {
                    type: 'or',
                    filters: [
                      { type: 'filter', property: 'A', operator: 'equals', value: '1' },
                      { type: 'filter', property: 'B', operator: 'equals', value: '2' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(() => validateNestingDepth(ast)).toThrow(/exceeds maximum depth/);
    });
  });

  describe('edge cases', () => {
    test('handles extra whitespace', () => {
      const result = parseFilter('  Name:contains:test   AND   Status:equals:Done  ', schema);
      expect(result.and).toHaveLength(2);
    });

    test('handles nested parentheses', () => {
      const result = parseFilter('((Name:contains:a OR Name:contains:b) AND Status:equals:c)', schema);
      expect(result.and).toHaveLength(2);
      expect(result.and[0].or).toHaveLength(2);
    });

    test('handles rich_text property type', () => {
      const result = parseFilter('Description:starts_with:Important', schema);
      expect(result).toEqual({
        property: 'Description',
        rich_text: {
          starts_with: 'Important',
        },
      });
    });

    test('handles select property type', () => {
      const result = parseFilter('Category:equals:Work', schema);
      expect(result).toEqual({
        property: 'Category',
        select: {
          equals: 'Work',
        },
      });
    });
  });
});
