const { normalizeNotionId } = require('./helpers');

/**
 * Token types for filter parsing
 */
const TokenType = {
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  AND: 'AND',
  OR: 'OR',
  FILTER: 'FILTER',
  EOF: 'EOF',
};

/**
 * Tokenize a filter string into parseable tokens
 * @param {string} filterString - Raw filter string
 * @returns {Array<{type: string, value: any}>} Array of tokens
 */
function tokenize(filterString) {
  const tokens = [];
  let i = 0;
  const str = filterString.trim();

  while (i < str.length) {
    // Skip whitespace
    if (/\s/.test(str[i])) {
      i++;
      continue;
    }

    // Left parenthesis
    if (str[i] === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(' });
      i++;
      continue;
    }

    // Right parenthesis
    if (str[i] === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')' });
      i++;
      continue;
    }

    // Check for AND/OR keywords
    const remaining = str.slice(i);
    const andMatch = remaining.match(/^(AND|and)\b/);
    const orMatch = remaining.match(/^(OR|or)\b/);

    if (andMatch) {
      tokens.push({ type: TokenType.AND, value: 'AND' });
      i += andMatch[0].length;
      continue;
    }

    if (orMatch) {
      tokens.push({ type: TokenType.OR, value: 'OR' });
      i += orMatch[0].length;
      continue;
    }

    // Parse filter expression: property:operator:value
    const filterMatch = parseFilterExpression(str, i);
    if (filterMatch) {
      tokens.push({
        type: TokenType.FILTER,
        value: filterMatch.filter,
      });
      i = filterMatch.endIndex;
      continue;
    }

    throw new Error(`Unexpected character at position ${i}: "${str[i]}"`);
  }

  tokens.push({ type: TokenType.EOF, value: null });
  return tokens;
}

/**
 * Parse a filter expression starting at given index
 * @param {string} str - Full filter string
 * @param {number} startIndex - Starting position
 * @returns {{filter: {property: string, operator: string, value: string}, endIndex: number} | null}
 */
function parseFilterExpression(str, startIndex) {
  let i = startIndex;
  const parts = [];
  let currentPart = '';
  let inQuotes = false;
  let quoteChar = null;
  let colonCount = 0;

  while (i < str.length) {
    const char = str[i];

    // Handle quotes
    if ((char === '"' || char === "'") && (i === startIndex || str[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
        i++;
        continue;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = null;
        i++;
        continue;
      }
    }

    // If in quotes, add everything to current part
    if (inQuotes) {
      currentPart += char;
      i++;
      continue;
    }

    // Colon separator (not in quotes)
    if (char === ':') {
      if (colonCount >= 2) {
        // This is part of the value (e.g., timestamp with colons)
        currentPart += char;
      } else {
        parts.push(currentPart);
        currentPart = '';
        colonCount++;
      }
      i++;
      continue;
    }

    // Stop at whitespace, parentheses, or AND/OR (not in quotes)
    if (/\s/.test(char) || char === '(' || char === ')') {
      break;
    }

    // Check if we're at start of AND/OR
    const remaining = str.slice(i);
    if (/^(AND|and|OR|or)\b/.test(remaining)) {
      break;
    }

    currentPart += char;
    i++;
  }

  // Add final part
  if (currentPart) {
    parts.push(currentPart);
  }

  // Validate we have exactly 3 parts
  if (parts.length !== 3) {
    return null;
  }

  const [property, operator, value] = parts;
  if (!property || !operator || value === undefined) {
    return null;
  }

  return {
    filter: {
      property: property.trim(),
      operator: operator.trim(),
      value: value.trim(),
    },
    endIndex: i,
  };
}

/**
 * Parser for filter expressions
 */
class FilterParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  currentToken() {
    return this.tokens[this.position];
  }

  peek() {
    return this.tokens[this.position + 1] || { type: TokenType.EOF };
  }

  advance() {
    this.position++;
  }

  /**
   * Parse the filter expression
   * Grammar (with precedence: OR > AND):
   *   expression := andExpression
   *   andExpression := orExpression (AND orExpression)*
   *   orExpression := primary (OR primary)*
   *   primary := FILTER | LPAREN expression RPAREN
   */
  parse() {
    const ast = this.parseAndExpression();
    if (this.currentToken().type !== TokenType.EOF) {
      throw new Error(`Unexpected token after expression: ${JSON.stringify(this.currentToken())}`);
    }
    return ast;
  }

  parseAndExpression() {
    let left = this.parseOrExpression();

    while (this.currentToken().type === TokenType.AND) {
      this.advance(); // consume AND
      const right = this.parseOrExpression();

      // Combine into AND node
      if (left.type === 'and') {
        left.filters.push(right);
      } else {
        left = {
          type: 'and',
          filters: [left, right],
        };
      }
    }

    return left;
  }

  parseOrExpression() {
    let left = this.parsePrimary();

    while (this.currentToken().type === TokenType.OR) {
      this.advance(); // consume OR
      const right = this.parsePrimary();

      // Combine into OR node
      if (left.type === 'or') {
        left.filters.push(right);
      } else {
        left = {
          type: 'or',
          filters: [left, right],
        };
      }
    }

    return left;
  }

  parsePrimary() {
    const token = this.currentToken();

    if (token.type === TokenType.FILTER) {
      this.advance();
      return {
        type: 'filter',
        property: token.value.property,
        operator: token.value.operator,
        value: token.value.value,
      };
    }

    if (token.type === TokenType.LPAREN) {
      this.advance(); // consume (
      const expr = this.parseAndExpression();
      if (this.currentToken().type !== TokenType.RPAREN) {
        throw new Error('Expected closing parenthesis');
      }
      this.advance(); // consume )
      return expr;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }
}

/**
 * Property type to Notion API property name mapping
 */
const PROPERTY_TYPE_TO_API_KEY = {
  title: 'title',
  rich_text: 'rich_text',
  number: 'number',
  select: 'select',
  multi_select: 'multi_select',
  date: 'date',
  people: 'people',
  files: 'files',
  checkbox: 'checkbox',
  url: 'url',
  email: 'email',
  phone_number: 'phone_number',
  formula: 'formula',
  relation: 'relation',
  rollup: 'rollup',
  created_time: 'created_time',
  created_by: 'created_by',
  last_edited_time: 'last_edited_time',
  last_edited_by: 'last_edited_by',
  status: 'status',
};

/**
 * Valid operators for each property type
 */
const VALID_OPERATORS = {
  title: ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  rich_text: ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  number: ['equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'is_empty', 'is_not_empty'],
  checkbox: ['equals', 'does_not_equal'],
  select: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  status: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  date: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty', 'past_week', 'past_month', 'past_year', 'next_week', 'next_month', 'next_year', 'this_week'],
  people: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  files: ['is_empty', 'is_not_empty'],
  relation: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  created_time: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty', 'past_week', 'past_month', 'past_year', 'next_week', 'next_month', 'next_year', 'this_week'],
  last_edited_time: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty', 'past_week', 'past_month', 'past_year', 'next_week', 'next_month', 'next_year', 'this_week'],
};

/**
 * Operators that don't take a value (they use empty object or boolean)
 */
const EMPTY_VALUE_OPERATORS = [
  'is_empty',
  'is_not_empty',
  'past_week',
  'past_month',
  'past_year',
  'next_week',
  'next_month',
  'next_year',
  'this_week',
];

const ID_OPERATORS = ['equals', 'does_not_equal', 'greater_than'];

/**
 * Convert AST to Notion API filter format
 * @param {Object} ast - Abstract syntax tree
 * @param {Object} propertySchema - Map of property name to property type
 * @returns {Object} Notion API filter object
 */
function astToNotionFilter(ast, propertySchema) {
  if (ast.type === 'filter') {
    return convertSingleFilter(ast, propertySchema);
  }

  if (ast.type === 'and' || ast.type === 'or') {
    return {
      [ast.type]: ast.filters.map((f) => astToNotionFilter(f, propertySchema)),
    };
  }

  throw new Error(`Unknown AST node type: ${ast.type}`);
}

/**
 * Convert a single filter AST node to Notion API format
 * @param {Object} filterNode - Filter AST node
 * @param {Object} propertySchema - Map of property name to property type
 * @returns {Object} Notion API filter object
 */
function convertSingleFilter(filterNode, propertySchema) {
  const { property, operator, value } = filterNode;

  // Special handling for timestamp properties
  if (property === 'created_time' || property === 'last_edited_time') {
    return convertTimestampFilter(property, operator, value);
  }

  // Special handling for page id
  if (property === 'id') {
    return convertIdFilter(operator, value);
  }

  // Get property type from schema
  const propertyType = propertySchema[property];
  if (!propertyType) {
    const availableProps = Object.keys(propertySchema).join(', ');
    throw new Error(
      `Property "${property}" not found in database schema. Available properties: ${availableProps}`
    );
  }

  // Validate operator for this property type
  const validOps = VALID_OPERATORS[propertyType];
  if (!validOps || !validOps.includes(operator)) {
    throw new Error(
      `Operator "${operator}" is not valid for property "${property}" (type: ${propertyType}). Valid operators: ${validOps ? validOps.join(', ') : 'none'}`
    );
  }

  // Get the API key for this property type
  const apiKey = PROPERTY_TYPE_TO_API_KEY[propertyType];
  if (!apiKey) {
    throw new Error(`Unsupported property type: ${propertyType}`);
  }

  // Convert value based on property type
  const convertedValue = convertFilterValue(propertyType, operator, value);

  return {
    property,
    [apiKey]: {
      [operator]: convertedValue,
    },
  };
}

/**
 * Convert timestamp filter (created_time, last_edited_time)
 * @param {string} property - created_time or last_edited_time
 * @param {string} operator - Filter operator
 * @param {string} value - Filter value
 * @returns {Object} Notion API timestamp filter
 */
function convertTimestampFilter(property, operator, value) {
  const validOps = VALID_OPERATORS[property];
  if (!validOps || !validOps.includes(operator)) {
    throw new Error(
      `Operator "${operator}" is not valid for timestamp property "${property}". Valid operators: ${validOps.join(', ')}`
    );
  }

  // is_empty and is_not_empty should be boolean true
  let convertedValue;
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    convertedValue = true;
  } else if (EMPTY_VALUE_OPERATORS.includes(operator)) {
    convertedValue = {};
  } else {
    convertedValue = value;
  }

  return {
    timestamp: property,
    [property]: {
      [operator]: convertedValue,
    },
  };
}

/**
 * Convert filter value based on property type and operator
 * @param {string} propertyType - Type of the property
 * @param {string} operator - Filter operator
 * @param {string} value - Raw value string
 * @returns {any} Converted value for Notion API
 */
function convertFilterValue(propertyType, operator, value) {
  // is_empty and is_not_empty should be boolean true
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return true;
  }

  // Other operators that don't take a value (timestamp operators)
  if (EMPTY_VALUE_OPERATORS.includes(operator)) {
    return {};
  }

  switch (propertyType) {
    case 'number': {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid number value for property: "${value}"`);
      }
      return num;
    }

    case 'checkbox': {
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error(`Checkbox value must be "true" or "false", got: "${value}"`);
    }

    case 'people':
    case 'relation': {
      // UUID value
      return normalizeNotionId(value) || value;
    }

    case 'title':
    case 'rich_text':
    case 'select':
    case 'multi_select':
    case 'status':
    case 'date':
    case 'url':
    case 'email':
    case 'phone_number':
    default:
      return value;
  }
}

/**
 * Parse a filter string and convert to Notion API filter format
 * @param {string} filterString - Filter string (e.g., "Name:contains:test AND Status:equals:Done")
 * @param {Object} propertySchema - Map of property name to property type from database schema
 * @returns {Object | null} Notion API filter object, or null if filterString is empty
 * @throws {Error} If filter syntax is invalid or properties/operators are invalid
 *
 * @example
 * const schema = { Name: 'title', Status: 'status', Priority: 'number' };
 * const filter = parseFilter('Name:contains:test AND Priority:greater_than:5', schema);
 * // Returns: { and: [ { property: 'Name', title: { contains: 'test' } }, { property: 'Priority', number: { greater_than: 5 } } ] }
 */
function parseFilter(filterString, propertySchema) {
  if (!filterString || !filterString.trim()) {
    return null;
  }

  // Tokenize
  const tokens = tokenize(filterString);

  // Parse into AST
  const parser = new FilterParser(tokens);
  const ast = parser.parse();
  validateNestingDepth(ast);

  // Convert AST to Notion API format
  const notionFilter = astToNotionFilter(ast, propertySchema);

  return notionFilter;
}

/**
 * Validate filter nesting depth (max 2 levels for Notion API)
 * @param {Object} ast - Abstract syntax tree
 * @param {number} currentDepth - Current nesting depth
 * @throws {Error} If nesting exceeds maximum depth
 */
function validateNestingDepth(ast, currentDepth = 0) {
  if (ast.type !== 'and' && ast.type !== 'or') {
    return;
  }

  if (currentDepth > 2) {
    throw new Error('Filter nesting exceeds maximum depth of 2 levels');
  }

  for (const filter of ast.filters) {
    validateNestingDepth(filter, currentDepth + 1);
  }
}

function convertIdFilter(operator, value) {
  if (!ID_OPERATORS.includes(operator)) {
    throw new Error(
      `Operator "${operator}" is not valid for property "id". Valid operators: ${ID_OPERATORS.join(', ')}`
    );
  }

  return {
    property: 'id',
    id: {
      [operator]: normalizeNotionId(value) || value,
    },
  };
}

module.exports = {
  parseFilter,
  tokenize,
  FilterParser,
  astToNotionFilter,
  validateNestingDepth,
};
