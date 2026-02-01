const { parseMarkdownSection } = require('../utils');

/**
 * Read all data from stdin as a UTF-8 string.
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';

    // If stdin is not piped, end immediately with empty string
    if (process.stdin.isTTY) {
      return resolve('');
    }

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', (err) => reject(err));
  });
}

/**
 * Normalize a raw date/datetime string into a Notion-compatible format.
 *
 * Supported inputs:
 * - YYYY-MM-DD
 * - YYYY-MM-DDTHH:MM
 * - YYYY-MM-DDTHH:MM:SS
 * - YYYY-MM-DD HH:MM
 * - YYYY-MM-DD HH:MM:SS
 *
 * Returns:
 * - YYYY-MM-DD (date only)
 * - YYYY-MM-DDTHH:MM:SSZ (datetime)
 * - null if input is not recognized as a date/datetime
 *
 * Note: time-only values (e.g. "8:25") are left unchanged by callers.
 */
function normalizeDateTimeString(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // Already full ISO 8601 with Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(trimmed)) {
    return trimmed;
  }

  // Date only
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Date + time, with space or "T" separator, optional seconds
  const m = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    const [, date, hh, mm, ss = '00'] = m;
    return `${date}T${hh}:${mm}:${ss}Z`;
  }

  return null;
}

/**
 * Coerce date/datetime-like properties into Notion-friendly string formats.
 *
 * Heuristic: operates on properties whose keys look like date/datetime fields:
 * - "date", "datetime"
 * - keys ending with "_date" or "_datetime"
 */
function coerceDateTimeProperties(properties) {
  if (!properties || typeof properties !== 'object') {
    return properties || {};
  }

  const result = { ...properties };

  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'string') continue;

    const lowerKey = key.toLowerCase();
    const looksLikeDateKey =
      lowerKey === 'date' ||
      lowerKey === 'datetime' ||
      lowerKey.endsWith('_date') ||
      lowerKey.endsWith('_datetime');

    if (!looksLikeDateKey) continue;

    const normalized = normalizeDateTimeString(value);
    if (normalized) {
      result[key] = normalized;
    }
  }

  return result;
}

/**
 * Parse a markdown block from stdin into structured metadata.
 *
 * Usage:
 *   echo "## Title\n- key: value\n\nBody" | node notion.js parse-block
 *
 * Outputs JSON:
 *   { "title": "...", "properties": {...}, "body": "..." }
 */
async function parseBlock() {
  try {
    const input = await readStdin();
    const parsed = parseMarkdownSection(input || '');

    const properties = coerceDateTimeProperties(parsed.properties || {});
    const result = {
      ...parsed,
      properties,
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message || String(err));
    process.exit(1);
  }
}

module.exports = {
  command: 'parse-block',
  describe: 'Parse a markdown block from stdin into structured metadata',

  builder: (yargs) => {
    return yargs; // no additional options
  },

  handler: () => {
    parseBlock();
  },

  // Export for programmatic use if needed
  parseBlock,
  // Export helpers for potential testing
  normalizeDateTimeString,
  coerceDateTimeProperties,
};


