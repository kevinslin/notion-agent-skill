import { normalizeNotionId } from './helpers';

const TokenType = {
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  AND: 'AND',
  OR: 'OR',
  FILTER: 'FILTER',
  EOF: 'EOF',
} as const;

type TokenTypeValue = (typeof TokenType)[keyof typeof TokenType];

type ParsedFilterExpression = {
  property: string;
  operator: string;
  value: string;
};

type FilterToken = {
  type: TokenTypeValue;
  value: ParsedFilterExpression | string | null;
};

export type FilterAst =
  | {
      type: 'filter';
      property: string;
      operator: string;
      value: string;
    }
  | {
      type: 'and' | 'or';
      filters: FilterAst[];
    };

type PropertySchema = Record<string, string>;

/**
 * Tokenize a filter string into parseable tokens
 */
export function tokenize(filterString: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  let i = 0;
  const str = filterString.trim();

  while (i < str.length) {
    if (/\s/.test(str[i])) {
      i += 1;
      continue;
    }

    if (str[i] === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(' });
      i += 1;
      continue;
    }

    if (str[i] === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')' });
      i += 1;
      continue;
    }

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

function parseFilterExpression(
  str: string,
  startIndex: number,
): { filter: ParsedFilterExpression; endIndex: number } | null {
  let i = startIndex;
  const parts: string[] = [];
  let currentPart = '';
  let inQuotes = false;
  let quoteChar: string | null = null;
  let colonCount = 0;

  while (i < str.length) {
    const char = str[i];

    if ((char === '"' || char === "'") && (i === startIndex || str[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
        i += 1;
        continue;
      }

      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = null;
        i += 1;
        continue;
      }
    }

    if (inQuotes) {
      currentPart += char;
      i += 1;
      continue;
    }

    if (char === ':') {
      if (colonCount >= 2) {
        currentPart += char;
      } else {
        parts.push(currentPart);
        currentPart = '';
        colonCount += 1;
      }
      i += 1;
      continue;
    }

    if (/\s/.test(char) || char === '(' || char === ')') {
      break;
    }

    const remaining = str.slice(i);
    if (/^(AND|and|OR|or)\b/.test(remaining)) {
      break;
    }

    currentPart += char;
    i += 1;
  }

  if (currentPart) {
    parts.push(currentPart);
  }

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

export class FilterParser {
  private readonly tokens: FilterToken[];

  private position = 0;

  constructor(tokens: FilterToken[]) {
    this.tokens = tokens;
  }

  currentToken(): FilterToken {
    return this.tokens[this.position];
  }

  peek(): FilterToken {
    return this.tokens[this.position + 1] || { type: TokenType.EOF, value: null };
  }

  advance(): void {
    this.position += 1;
  }

  parse(): FilterAst {
    const ast = this.parseAndExpression();
    if (this.currentToken().type !== TokenType.EOF) {
      throw new Error(`Unexpected token after expression: ${JSON.stringify(this.currentToken())}`);
    }
    return ast;
  }

  private parseAndExpression(): FilterAst {
    let left = this.parseOrExpression();

    while (this.currentToken().type === TokenType.AND) {
      this.advance();
      const right = this.parseOrExpression();

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

  private parseOrExpression(): FilterAst {
    let left = this.parsePrimary();

    while (this.currentToken().type === TokenType.OR) {
      this.advance();
      const right = this.parsePrimary();

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

  private parsePrimary(): FilterAst {
    const token = this.currentToken();

    if (token.type === TokenType.FILTER) {
      const value = token.value as ParsedFilterExpression;
      this.advance();
      return {
        type: 'filter',
        property: value.property,
        operator: value.operator,
        value: value.value,
      };
    }

    if (token.type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseAndExpression();
      if (this.currentToken().type !== TokenType.RPAREN) {
        throw new Error('Expected closing parenthesis');
      }
      this.advance();
      return expr;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }
}

const PROPERTY_TYPE_TO_API_KEY: Record<string, string> = {
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

const VALID_OPERATORS: Record<string, string[]> = {
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

export function astToNotionFilter(ast: FilterAst, propertySchema: PropertySchema): Record<string, unknown> {
  if (ast.type === 'filter') {
    return convertSingleFilter(ast, propertySchema);
  }

  if (ast.type === 'and' || ast.type === 'or') {
    return {
      [ast.type]: ast.filters.map((filter) => astToNotionFilter(filter, propertySchema)),
    };
  }

  throw new Error(`Unknown AST node type: ${(ast as { type?: string }).type}`);
}

function convertSingleFilter(
  filterNode: Extract<FilterAst, { type: 'filter' }>,
  propertySchema: PropertySchema,
): Record<string, unknown> {
  const { property, operator, value } = filterNode;

  if (property === 'created_time' || property === 'last_edited_time') {
    return convertTimestampFilter(property, operator, value);
  }

  if (property === 'id') {
    return convertIdFilter(operator, value);
  }

  const propertyType = propertySchema[property];
  if (!propertyType) {
    const availableProps = Object.keys(propertySchema).join(', ');
    throw new Error(
      `Property "${property}" not found in database schema. Available properties: ${availableProps}`,
    );
  }

  const validOps = VALID_OPERATORS[propertyType];
  if (!validOps || !validOps.includes(operator)) {
    throw new Error(
      `Operator "${operator}" is not valid for property "${property}" (type: ${propertyType}). Valid operators: ${validOps ? validOps.join(', ') : 'none'}`,
    );
  }

  const apiKey = PROPERTY_TYPE_TO_API_KEY[propertyType];
  if (!apiKey) {
    throw new Error(`Unsupported property type: ${propertyType}`);
  }

  const convertedValue = convertFilterValue(propertyType, operator, value);

  return {
    property,
    [apiKey]: {
      [operator]: convertedValue,
    },
  };
}

function convertTimestampFilter(property: string, operator: string, value: string): Record<string, unknown> {
  const validOps = VALID_OPERATORS[property];
  if (!validOps || !validOps.includes(operator)) {
    throw new Error(
      `Operator "${operator}" is not valid for timestamp property "${property}". Valid operators: ${validOps.join(', ')}`,
    );
  }

  let convertedValue: boolean | string | Record<string, never>;
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

function convertFilterValue(propertyType: string, operator: string, value: string): boolean | number | string | Record<string, never> {
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return true;
  }

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

    case 'checkbox':
      if (value === 'true') {
        return true;
      }
      if (value === 'false') {
        return false;
      }
      throw new Error(`Checkbox value must be "true" or "false", got: "${value}"`);

    case 'people':
    case 'relation':
      return normalizeNotionId(value) || value;

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

export function parseFilter(
  filterString: string | null | undefined,
  propertySchema: PropertySchema,
): Record<string, unknown> | null {
  if (!filterString || !filterString.trim()) {
    return null;
  }

  const tokens = tokenize(filterString);
  const parser = new FilterParser(tokens);
  const ast = parser.parse();
  validateNestingDepth(ast);

  return astToNotionFilter(ast, propertySchema);
}

export function validateNestingDepth(ast: FilterAst, currentDepth = 0): void {
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

function convertIdFilter(operator: string, value: string): Record<string, unknown> {
  if (!ID_OPERATORS.includes(operator)) {
    throw new Error(
      `Operator "${operator}" is not valid for property "id". Valid operators: ${ID_OPERATORS.join(', ')}`,
    );
  }

  return {
    property: 'id',
    id: {
      [operator]: normalizeNotionId(value) || value,
    },
  };
}
