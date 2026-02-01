const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const os = require('os');
const homeDir = os.homedir();

/**
 * Load NOTION_TOKEN from kevin-garden/.env or .env.test by traversing up the directory tree
 * @param {string} startDir - Starting directory (defaults to current working directory)
 * @returns {string} The NOTION_TOKEN value
 * @throws {Error} If kevin-garden directory or .env file is not found, or NOTION_TOKEN is not set
 */
function loadEnv(startDir = process.cwd()) {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  // Determine which env file to load based on NODE_ENV
  const isTest = process.env.NODE_ENV === 'test';
  const envFileName = isTest ? '.env.test' : '.env';

  let kevinGardenDir = null;

  // Traverse up until we find kevin-garden directory
  while (currentDir !== root) {
    if (path.basename(currentDir) === 'kevin-garden') {
      kevinGardenDir = currentDir;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (kevinGardenDir) {
    const envPath = path.join(kevinGardenDir, envFileName);
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath, override: true });
      if (result.error) {
        throw new Error(`Error loading ${envFileName} from ${envPath}: ${result.error.message}`);
      }

      const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
      if (!token) {
        throw new Error(`NOTION_TOKEN (or NOTION_API_KEY) is required but not set in ${envFileName} file`);
      }
      return token;
    }
  }

  const homeEnvPath = path.join(homeDir, envFileName);
  if (fs.existsSync(homeEnvPath)) {
    const result = dotenv.config({ path: homeEnvPath, override: true });
    if (result.error) {
      throw new Error(`Error loading ${envFileName} from ${homeEnvPath}: ${result.error.message}`);
    }

    const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
    if (!token) {
      throw new Error(`NOTION_TOKEN (or NOTION_API_KEY) is required but not set in ${envFileName} file`);
    }
    return token;
  }

  if (kevinGardenDir) {
    throw new Error(`Found kevin-garden directory at ${kevinGardenDir} but ${envFileName} file does not exist`);
  }

  throw new Error(`did not find kevin-garden directory or ${envFileName} in home directory when starting from ${startDir}`);
}

/**
 * Normalize a Notion ID to the standard UUID format with dashes
 * @param {string} raw - Raw Notion ID (with or without dashes)
 * @returns {string|null} Normalized ID or null if input is falsy
 */
function normalizeNotionId(raw) {
  if (!raw) {
    return null;
  }
  const cleaned = String(raw).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (cleaned.length !== 32) {
    return raw;
  }
  return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`;
}

/**
 * Coerce a string value to the appropriate Notion property type structure
 * @param {string} type - Notion property type
 * @param {string} raw - Raw string value to coerce
 * @returns {Object} Notion property value object
 * @throws {Error} If property type is unsupported or value is invalid
 */
function coerceValueForPropertyType(type, raw) {
  switch (type) {
    case 'title':
      return { title: [{ type: 'text', text: { content: raw } }] };
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: raw } }] };
    case 'url':
      return { url: raw };
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new Error(`Invalid number for property: ${raw}`);
      }
      return { number: n };
    }
    case 'date':
      return { date: { start: raw } }; // Expect YYYY-MM-DD or ISO8601
    case 'select':
      return { select: { name: raw } };
    case 'multi_select': {
      const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }));
      return { multi_select: items };
    }
    case 'status':
      return { status: { name: raw } };
    case 'checkbox':
      return { checkbox: raw === 'true' };
    case 'email':
      return { email: raw };
    case 'phone_number':
      return { phone_number: raw };
    case 'relation': {
      // Comma-separated list of Notion page IDs
      const ids = String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({ id: normalizeNotionId(id) }));
      return { relation: ids };
    }
    default:
      throw new Error(`Unsupported property type: ${type}`);
  }
}

/**
 * Parse body input - determines if it's a file path or raw content
 * @param {string} bodyFlagValue - Value from --bodyFromRawMarkdown or --bodyFromTextFile
 * @returns {{content: string|null, sourcePath: string|null}} Parsed body content and source path
 */
function parseBodyInput(bodyFlagValue) {
  if (!bodyFlagValue) {
    return { content: null, sourcePath: null };
  }

  const possiblePath = path.resolve(process.cwd(), bodyFlagValue);
  if (fs.existsSync(possiblePath) && fs.statSync(possiblePath).isFile()) {
    return {
      content: fs.readFileSync(possiblePath, 'utf8'),
      sourcePath: possiblePath
    };
  } else {
    return {
      content: bodyFlagValue,
      sourcePath: null
    };
  }
}

/**
 * Convert markdown text to Notion paragraph blocks
 * @param {string} markdown - Markdown text
 * @returns {Array} Array of Notion paragraph block objects
 */
function markdownToParagraphBlocks(markdown) {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  return lines.map((line) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: line.substring(0, 2000) },
        },
      ],
    },
  }));
}

/**
 * Parse a markdown section into structured metadata.
 *
 * Expected format:
 *
 * ## Title line
 * - key: value
 * - key2: value2
 *
 * Body text...
 *
 * @param {string} markdown
 * @returns {{ title: string | null, properties: Record<string, string>, body: string }}
 */
function parseMarkdownSection(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return { title: null, properties: {}, body: '' };
  }

  const lines = markdown.split(/\r?\n/);
  let title = null;
  const properties = {};
  const bodyLines = [];

  /** @type {'header' | 'maybeMetadata' | 'metadata' | 'body'} */
  let phase = 'header';

  for (const line of lines) {
    const trimmed = line.trim();

    if (phase === 'header') {
      if (!trimmed) {
        continue;
      }
      const m = trimmed.match(/^#{1,6}\s+(.*)$/);
      if (m) {
        title = m[1].trim();
        phase = 'maybeMetadata';
        continue;
      }
      // No explicit heading found, treat this line as start of body
      phase = 'body';
      bodyLines.push(line);
      continue;
    }

    if (phase === 'maybeMetadata' || phase === 'metadata') {
      if (!trimmed && phase === 'maybeMetadata') {
        // Allow blank line between header and metadata
        continue;
      }

      if (/^- /.test(trimmed)) {
        // Metadata bullet line: "- key: value"
        const withoutDash = trimmed.slice(2).trim();
        const [rawKey, ...rest] = withoutDash.split(':');
        if (rawKey && rest.length > 0) {
          const key = rawKey.trim().toLowerCase();
          let value = rest.join(':').trim();

          // Normalize some known fields
          if (key === 'source' && value) {
            const lower = value.toLowerCase();
            value = lower.charAt(0).toUpperCase() + lower.slice(1);
          }

          properties[key] = value;
          phase = 'metadata';
          continue;
        }
      }

      // First non-metadata line → start of body
      phase = 'body';
      if (line.length > 0) {
        bodyLines.push(line);
      }
      continue;
    }

    if (phase === 'body') {
      bodyLines.push(line);
    }
  }

  const body = bodyLines.join('\n').trim();

  return { title, properties, body };
}

module.exports = {
  loadEnv,
  normalizeNotionId,
  coerceValueForPropertyType,
  parseBodyInput,
  markdownToParagraphBlocks,
  parseMarkdownSection,
};
