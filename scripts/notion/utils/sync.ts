import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

type FrontmatterData = Record<string, unknown>;

export type FrontmatterParseResult = {
  data: FrontmatterData;
  body: string;
  hasFrontmatter: boolean;
};

export type CsvRow = Record<string, string>;

export function parseFrontmatter(markdown?: string | null): FrontmatterParseResult {
  if (!markdown || typeof markdown !== 'string') {
    return { data: {}, body: '', hasFrontmatter: false };
  }

  const lines = markdown.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') {
    return { data: {}, body: markdown, hasFrontmatter: false };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '---' || line === '...') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { data: {}, body: markdown, hasFrontmatter: false };
  }

  const yamlText = lines.slice(1, endIndex).join('\n');
  let data: FrontmatterData = {};
  if (yamlText.trim()) {
    const parsed = yaml.load(yamlText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as FrontmatterData;
    }
  }

  const bodyLines = lines.slice(endIndex + 1);
  if (bodyLines.length && bodyLines[0].trim() === '') {
    bodyLines.shift();
  }

  const body = bodyLines.join('\n').replace(/\s+$/, '');

  return {
    data,
    body,
    hasFrontmatter: true,
  };
}

export function serializeFrontmatter(data: FrontmatterData | null | undefined, body?: string): string {
  const safeData = data && typeof data === 'object' ? data : {};
  const yamlText = yaml.dump(safeData, { lineWidth: 120, noRefs: true }).trimEnd();
  const trimmedBody = typeof body === 'string' ? body.replace(/\s+$/, '') : '';

  const parts = ['---', yamlText, '---'];
  if (trimmedBody) {
    parts.push('', trimmedBody);
  }

  return `${parts.join('\n')}\n`;
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchFnameTrigger(fname?: string | null, trigger?: string | null): boolean {
  if (!fname || !trigger) {
    return false;
  }
  const pattern = `^${escapeRegex(trigger).replace(/\\\*/g, '.*')}$`;
  const regex = new RegExp(pattern);
  return regex.test(fname);
}

export function parseMultiSelectValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [String(raw).trim()].filter(Boolean);
}

export function mergeMultiSelectValues(existing: string[] | null | undefined, incoming: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  const addValue = (value: string) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  };

  (existing || []).forEach(addValue);
  (incoming || []).forEach(addValue);

  return merged;
}

export function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function extractNotionIdFromUrl(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const dashed = rawUrl.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (dashed) {
    return dashed[0];
  }
  const compact = rawUrl.match(/[a-f0-9]{32}/i);
  if (compact) {
    return compact[0];
  }
  return null;
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Expected directory at: ${dirPath}`);
  }
}

export function collectMarkdownFiles(rootPath: string, ignoreDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootPath)) {
    return results;
  }

  const stats = fs.statSync(rootPath);
  if (stats.isFile()) {
    if (path.extname(rootPath) === '.md') {
      results.push(rootPath);
    }
    return results;
  }

  if (!stats.isDirectory()) {
    return results;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) {
        continue;
      }
      results.push(...collectMarkdownFiles(fullPath, ignoreDirs));
    } else if (entry.isFile() && path.extname(entry.name) === '.md') {
      results.push(fullPath);
    }
  }

  return results;
}

function collectFilesByExtension(rootPath: string, extension: string, ignoreDirs: Set<string> = new Set()): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootPath)) {
    return results;
  }

  const stats = fs.statSync(rootPath);
  if (stats.isFile()) {
    if (path.extname(rootPath) === extension) {
      results.push(rootPath);
    }
    return results;
  }

  if (!stats.isDirectory()) {
    return results;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) {
        continue;
      }
      results.push(...collectFilesByExtension(fullPath, extension, ignoreDirs));
    } else if (entry.isFile() && path.extname(entry.name) === extension) {
      results.push(fullPath);
    }
  }

  return results;
}

export function collectCsvFiles(rootPath: string, ignoreDirs: Set<string> = new Set()): string[] {
  return collectFilesByExtension(rootPath, '.csv', ignoreDirs);
}

export function parseCsv(csvText?: string | null): { headers: string[]; rows: CsvRow[] } {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [] };
  }

  const rawRows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (inQuotes) {
      if (char === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rawRows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rawRows.push(row);
  }

  const normalizedRows = rawRows.filter((cells) => cells.some((cell) => cell !== ''));
  if (!normalizedRows.length) {
    return { headers: [], rows: [] };
  }

  const headers = normalizedRows[0].map((header) => String(header || '').trim());
  const rows = normalizedRows.slice(1).map((cells) => {
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      if (!header) {
        return;
      }
      record[header] = cells[index] !== undefined ? cells[index] : '';
    });
    return record;
  });

  return { headers, rows };
}

function escapeCsvValue(value: unknown): string {
  const stringValue = value === undefined || value === null ? '' : String(value);
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function serializeCsv(headers: string[] | null | undefined, rows: CsvRow[] | null | undefined): string {
  const safeHeaders = Array.isArray(headers) ? headers.filter(Boolean) : [];
  if (!safeHeaders.length) {
    return '';
  }

  const lines = [
    safeHeaders.map(escapeCsvValue).join(','),
    ...(rows || []).map((row) => safeHeaders.map((header) => escapeCsvValue(row ? row[header] : '')).join(',')),
  ];

  return `${lines.join('\n')}\n`;
}
