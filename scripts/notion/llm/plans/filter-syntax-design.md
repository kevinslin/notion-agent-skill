# Notion CLI Filter Syntax Design

**Date:** 2025-12-15
**Purpose:** Define a CLI-friendly filter syntax that maps to Notion's database query filter API

---

## Design Goals

1. **CLI-friendly**: Easy to type on command line without complex escaping
2. **Comprehensive**: Support all Notion property types and operators
3. **Composable**: Support compound filters (AND/OR) with nesting
4. **Readable**: Human-readable syntax that's self-documenting
5. **Unambiguous**: Clear parsing rules without edge cases

---

## Syntax Overview

### Basic Filter Format
```
property:operator:value
```

**Examples:**
```bash
Name:contains:test
Status:equals:Done
Priority:greater_than:5
created_time:after:2025-01-01
Tags:contains:urgent
```

### Compound Filters
```bash
# AND (all conditions must match)
Name:contains:test AND Status:equals:Done

# OR (any condition must match)
Status:equals:Done OR Status:equals:In Progress

# Nested with parentheses (up to 2 levels deep per Notion API)
(Name:contains:test OR Name:contains:draft) AND Status:equals:Done
created_time:after:2025-01-01 AND (Priority:greater_than:5 OR Tags:contains:urgent)
```

---

## Property Type Operators

### Text Properties (rich_text, title)
```
Name:equals:exact match
Name:contains:partial
Name:does_not_contain:exclude
Name:starts_with:prefix
Name:ends_with:suffix
Name:is_empty:true
Name:is_not_empty:true
```

### Number Properties
```
Priority:equals:5
Priority:does_not_equal:0
Priority:greater_than:3
Priority:greater_than_or_equal_to:3
Priority:less_than:10
Priority:less_than_or_equal_to:10
Priority:is_empty:true
Priority:is_not_empty:true
```

### Date Properties
```
Date:equals:2025-01-15
Date:before:2025-01-15
Date:after:2025-01-01
Date:on_or_before:2025-01-15
Date:on_or_after:2025-01-01
Date:is_empty:true
Date:is_not_empty:true

# Relative dates
Date:this_week:true
Date:next_week:true
Date:next_month:true
Date:next_year:true
Date:past_week:true
Date:past_month:true
Date:past_year:true
```

### Checkbox Properties
```
Done:equals:true
Done:equals:false
Done:does_not_equal:true
```

### Select Properties (select, status)
```
Status:equals:Done
Status:does_not_equal:Todo
Status:is_empty:true
Status:is_not_empty:true
```

### Multi-select Properties
```
Tags:contains:urgent
Tags:does_not_contain:archived
Tags:is_empty:true
Tags:is_not_empty:true
```

### Relation Properties
```
# Value is a page ID
RelatedPages:contains:2ca611ce-280d-816c-bf96-c02313ad2d4f
RelatedPages:does_not_contain:2ca611ce-280d-816c-bf96-c02313ad2d4f
RelatedPages:is_empty:true
RelatedPages:is_not_empty:true
```

### People Properties
```
# Value is a user ID (UUIDv4)
Assignee:contains:f7924677-2f4d-4cbe-8fcf-87e27bf9f263
Assignee:does_not_contain:f7924677-2f4d-4cbe-8fcf-87e27bf9f263
Assignee:is_empty:true
Assignee:is_not_empty:true
```

### Timestamp Properties (created_time, last_edited_time)
```
created_time:after:2025-01-01T00:00:00Z
created_time:before:2025-12-31T23:59:59Z
created_time:on_or_after:2025-01-01
created_time:on_or_before:2025-12-31
created_time:past_week:true
created_time:this_week:true
last_edited_time:after:2025-01-01
```

### Files Properties
```
Attachments:is_empty:true
Attachments:is_not_empty:true
```

### ID Properties
```
id:equals:2ca611ce-280d-816c-bf96-c02313ad2d4f
id:does_not_equal:2ca611ce-280d-816c-bf96-c02313ad2d4f
id:greater_than:2ca611ce-280d-816c-bf96-c02313ad2d4f
```

---

## Syntax Rules

### 1. Basic Structure
- Format: `property:operator:value`
- Property names are case-sensitive (match database schema exactly)
- Operators are lowercase with underscores
- Values depend on property type

### 2. Value Handling
- **Spaces in values**: Use quotes
  ```bash
  Name:contains:"my project"
  Status:equals:"In Progress"
  ```
- **Boolean values**: `true` or `false` (lowercase)
- **Empty checks**: Use `true` as value
  ```bash
  Name:is_empty:true
  ```
- **Dates**: ISO8601 format `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`
- **UUIDs**: Full UUID with dashes

### 3. Compound Operators
- **AND**: All conditions must match (case-insensitive)
- **OR**: Any condition must match (case-insensitive)
- Precedence: OR has higher precedence than AND (like most programming languages)
- Use parentheses to override precedence

### 4. Nesting
- Maximum 2 levels of nesting (Notion API limitation)
- Use parentheses for grouping
- Valid: `(A OR B) AND (C OR D)`
- Valid: `((A OR B) AND C) OR D`
- Invalid: `(((A OR B) OR C) OR D)` (3 levels)

### 5. Whitespace
- Whitespace around operators is ignored
- These are equivalent:
  ```bash
  Name:contains:test AND Status:equals:Done
  Name:contains:test  AND  Status:equals:Done
  ```

---

## Command-Line Usage

### Single Filter
```bash
node notion.js query --database-id abc123 \
  --filter "Status:equals:Done"
```

### Multiple Conditions (AND)
```bash
node notion.js query --database-id abc123 \
  --filter "Status:equals:Done AND Priority:greater_than:5"
```

### Multiple Conditions (OR)
```bash
node notion.js query --database-id abc123 \
  --filter "Status:equals:Done OR Status:equals:In Progress"
```

### Nested Conditions
```bash
node notion.js query --database-id abc123 \
  --filter "(Name:contains:urgent OR Priority:greater_than:8) AND Status:equals:Todo"
```

### With Quotes in Values
```bash
node notion.js query --database-id abc123 \
  --filter 'Name:contains:"project alpha" AND Status:equals:"In Progress"'
```

### Complex Example
```bash
node notion.js query --database-id abc123 \
  --filter 'created_time:past_week:true AND (Tags:contains:urgent OR Priority:greater_than:7) AND Status:does_not_equal:Archived'
```

---

## Parser Implementation Strategy

### Tokenization
1. Split on whitespace (respecting quoted strings)
2. Identify tokens: `(`, `)`, `AND`, `OR`, filter expressions
3. Parse filter expressions: `property:operator:value`

### Parsing Algorithm
1. Use recursive descent parser
2. Handle operator precedence (parentheses > OR > AND)
3. Build AST (Abstract Syntax Tree)
4. Convert AST to Notion API filter JSON

### AST Structure
```javascript
// Simple filter
{
  type: 'filter',
  property: 'Name',
  operator: 'contains',
  value: 'test'
}

// Compound filter
{
  type: 'and',
  filters: [
    { type: 'filter', property: 'Name', operator: 'contains', value: 'test' },
    { type: 'filter', property: 'Status', operator: 'equals', value: 'Done' }
  ]
}

// Nested filter
{
  type: 'and',
  filters: [
    {
      type: 'or',
      filters: [
        { type: 'filter', property: 'Name', operator: 'contains', value: 'urgent' },
        { type: 'filter', property: 'Priority', operator: 'greater_than', value: '8' }
      ]
    },
    { type: 'filter', property: 'Status', operator: 'equals', value: 'Todo' }
  ]
}
```

### Conversion to Notion API Format

The AST is then converted to Notion's filter JSON format:

```javascript
// Simple filter
{
  property: 'Name',
  rich_text: {
    contains: 'test'
  }
}

// Compound AND filter
{
  and: [
    { property: 'Name', rich_text: { contains: 'test' } },
    { property: 'Status', status: { equals: 'Done' } }
  ]
}

// Nested filter
{
  and: [
    {
      or: [
        { property: 'Name', rich_text: { contains: 'urgent' } },
        { property: 'Priority', number: { greater_than: 8 } }
      ]
    },
    { property: 'Status', status: { equals: 'Todo' } }
  ]
}

// Timestamp filter
{
  timestamp: 'created_time',
  created_time: {
    past_week: {}
  }
}
```

---

## Type Inference

The parser needs to know property types to generate correct filter JSON. Two approaches:

### Approach 1: Fetch Schema First (Recommended)
1. Before parsing filter, fetch database schema
2. Build property name → type mapping
3. Use type information during conversion to API format
4. Validate operators against property type

### Approach 2: Infer from Operator
- Some operators are unique to property types
- `contains` on text vs multi-select produces different JSON
- Less reliable, could produce incorrect filters

**Recommendation**: Use Approach 1 (schema-first) like the create command does.

---

## Error Handling

### Invalid Property Names
```
Error: Property "InvalidProp" not found in database schema.
Available properties: Name, Status, Priority, Tags, Date
```

### Invalid Operators
```
Error: Operator "contains" is not valid for property "Priority" (type: number).
Valid operators: equals, does_not_equal, greater_than, greater_than_or_equal_to, less_than, less_than_or_equal_to, is_empty, is_not_empty
```

### Syntax Errors
```
Error: Invalid filter syntax near: "Name:contains:"
Expected value after operator
```

### Nesting Too Deep
```
Error: Filter nesting exceeds maximum depth of 2 levels
Filter: (((A OR B) OR C) OR D)
```

---

## Alternative Syntaxes Considered

### JSON (Rejected)
```bash
--filter '{"and":[{"property":"Name","rich_text":{"contains":"test"}}]}'
```
**Pros**: Direct API mapping, no parsing
**Cons**: Too verbose, requires heavy escaping, hard to read/write

### S-expressions (Rejected)
```bash
--filter '(and (Name contains "test") (Status equals "Done"))'
```
**Pros**: Clean nesting, familiar to Lisp users
**Cons**: Unfamiliar to most developers, still requires quotes

### Repeated Flags (Rejected)
```bash
--filter Name:contains:test --filter Status:equals:Done --filter-logic and
```
**Pros**: No escaping needed
**Cons**: Can't express complex nesting, unclear precedence

### MongoDB-style (Rejected)
```bash
--filter '{Name: {$contains: "test"}, Status: {$eq: "Done"}}'
```
**Pros**: Familiar to MongoDB users
**Cons**: Still JSON-like, requires escaping, verbose

---

## Implementation Checklist

- [ ] Create filter parser module (`utils/filterParser.js`)
- [ ] Implement tokenizer (handle quotes, parentheses, operators)
- [ ] Implement recursive descent parser
- [ ] Build AST from tokens
- [ ] Implement AST → Notion API converter
- [ ] Add schema-based type inference
- [ ] Add operator validation per property type
- [ ] Add comprehensive error messages
- [ ] Write unit tests for parser
- [ ] Write integration tests for query command
- [ ] Update CLAUDE.md with filter documentation
- [ ] Add examples to help text

---

## Testing Strategy

### Unit Tests (Parser)
```javascript
describe('Filter Parser', () => {
  test('parses simple filter', () => {
    expect(parse('Name:contains:test')).toEqual({
      type: 'filter',
      property: 'Name',
      operator: 'contains',
      value: 'test'
    });
  });

  test('parses AND compound filter', () => {
    expect(parse('Name:contains:test AND Status:equals:Done')).toEqual({
      type: 'and',
      filters: [...]
    });
  });

  test('parses nested filter with parentheses', () => {
    expect(parse('(A:equals:1 OR B:equals:2) AND C:equals:3')).toEqual(...);
  });

  test('handles quoted values with spaces', () => {
    expect(parse('Name:contains:"my project"')).toEqual(...);
  });

  test('throws on invalid syntax', () => {
    expect(() => parse('Name:contains:')).toThrow('Expected value');
  });
});
```

### Integration Tests
```javascript
describe('Query Command with Filters', () => {
  test('filters by status', async () => {
    const pages = await query({
      databaseId: TEST_DB_ID,
      filter: 'Status:equals:Done'
    });
    expect(pages.every(p => p.properties.Status.status.name === 'Done')).toBe(true);
  });

  test('filters with compound AND', async () => {
    const pages = await query({
      databaseId: TEST_DB_ID,
      filter: 'Status:equals:Done AND Priority:greater_than:5'
    });
    // Verify results match both conditions
  });
});
```

---

## Future Enhancements

### Saved Filter Presets
Allow users to define commonly-used filters in config:
```yaml
# .notionrc
filters:
  urgent: "(Priority:greater_than:7 OR Tags:contains:urgent) AND Status:does_not_equal:Done"
  recent: "created_time:past_week:true"
```

Usage:
```bash
node notion.js query --database-id abc123 --filter @urgent
```

### Filter Aliases
Short aliases for common operators:
```bash
Name=test          # equals
Name~=test         # contains
Name^=test         # starts_with
Priority>5         # greater_than
Date>=2025-01-01   # on_or_after
```

### Environment-Specific Filters
```bash
# In .env
DEFAULT_FILTER="Status:does_not_equal:Archived"

# Applied automatically to all queries
node notion.js query --database-id abc123
```

---

## References

- [Notion API Filter Documentation](https://developers.notion.com/reference/post-database-query-filter)
- [Notion API Query Database](https://developers.notion.com/reference/post-database-query)
