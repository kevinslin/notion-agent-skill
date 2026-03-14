# Notion CLI usage guide

Notion CLI creates pages, syncs notes, and syncs database metadata from your Notion workspace.
It uses the official Notion API and reads your integration token from the environment or a `.env` file.

Commands below use `node dist/notion.js`. If you have a local bin set up, replace that with `notion`.

## Quickstart

```bash
npm install
npm run build
export NOTION_TOKEN=secret_xxx
node dist/notion.js list-db --limit 5 --format table
```

## Authentication

- Set `NOTION_TOKEN` (or `NOTION_API_KEY`) in your environment or `.env`.

## Commands

### `create`

Create a new page in a Notion database.

Options:

- `--database-id` (required): Database ID where the page will be created.
- `--properties`: Page properties in `key=value` format (repeatable).
- `--bodyFromRawMarkdown`: Raw markdown content for the page body.
- `--bodyFromTextFile`: Path to a text file containing markdown for the page body.

Examples:

```bash
node dist/notion.js create --database-id <db-id> --properties Name="Daily note" --properties Date=2026-01-29
node dist/notion.js create --database-id <db-id> --properties Name="Release notes" --bodyFromTextFile ./notes.md
```

### `list-db`

List all databases accessible to the integration.

Options:

- `--limit`: Maximum number of databases to return. Default 100.
- `--format`: Output format: `json` or `table`. Default `json`.

Examples:

```bash
node dist/notion.js list-db
node dist/notion.js list-db --limit 10 --format table
```

### `lookup`

Search Notion pages and databases by query text using Notion Search API.

Options:

- positional `query`: Query text to search for (optional).
- `--filter`: Search filter in `object:value` format. Supported values: `page`, `database` (`data_source` accepted as alias).
- `--sort`: Sort in `last_edited_time:ascending|descending` format (`asc`/`desc` also accepted).
- `--limit`: Maximum number of results to return (default: all).
- `--start-cursor`: Optional pagination cursor to continue from.
- `--format`: Output format: `json` (default) or `table`.

Examples:

```bash
node dist/notion.js lookup "project alpha"
node dist/notion.js lookup "project alpha" --filter object:page --sort last_edited_time:descending --limit 10
node dist/notion.js lookup --filter object:database --format table
```

### `fetch`

Fetch pages from a Notion database.

Options:

- `--database-id`: Database ID to fetch from (required if no name is provided).
- `--database-name`: Database name to fetch from (uses cache if available).
- `--query`: Wildtext query applied to the title property (uses `contains`).
- `--filter` / `--filters`: Filter string using the filter syntax.
- `--output`: Output format: `json` (default) or `md`.
- `--limit`: Maximum number of pages to return (default: all).
- `--env`: `production` or `test` (controls cache filename).

Examples:

```bash
node dist/notion.js fetch --database-id <db-id>
node dist/notion.js fetch --database-name "Tasks" --query "urgent"
node dist/notion.js fetch --database-id <db-id> --filters "Status:equals:Done" --output md
```

Output (JSON):

```json
[
  {
    "id": "2ca611ce-280d-816c-bf96-c02313ad2d4f",
    "title": "Example title",
    "properties": {
      "Status": "Not started",
      "Tags": ["urgent"]
    },
    "body": "Example body text"
  }
]
```

Output (Markdown):

```md
# Example title
- properties: {"Status":"Not started","Tags":["urgent"]}

Example body text
```

### `sync-meta`

Sync database metadata and cache it locally.

Options:

- `--limit`: Maximum number of databases to sync.
- `--env`: `production` or `test` (controls cache filename). Default is `production` unless `NODE_ENV=test`.

Examples:

```bash
node dist/notion.js sync-meta
node dist/notion.js sync-meta --env test --limit 10
```

### `sync`

Sync local markdown notes or CSV files to Notion using YAML rule files in `~/.notion-agents-skill/syncRules/`.

Options:

- `--from`: Required source format: `md` or `csv`. If omitted in an interactive terminal, the CLI prompts for it.
- `--operation`: For CSV sources, `sync` creates or updates rows; `update` only updates rows that already exist in Notion.
- `--columns`: For CSV operations, limit processing to the listed source or target columns.
- `--limit`: For CSV operations, cap the number of rows processed in a run.
- `--rule`: Run a specific rule (matches rule filename or `name` field).
- `--path`: Additional file or directory paths to scan (repeatable).
- `--dry-run`: Print planned actions without writing changes.
- `--rules-dir`: Directory containing `.yaml`/`.yml` rule files (defaults to `~/.notion-agents-skill/syncRules`).
- positional `path`: Provide a single file or directory after `sync` to only sync that target.

Notes:

- With `--from md`, notes are discovered under `notes/` by default if it exists, otherwise the current working directory.
- With `--from csv`, files are discovered under the current working directory unless you provide a positional target or `--path`.
- A markdown note is considered synced if it has a `notion_url` field in frontmatter.
- CSV rows persist sync metadata in `dendron_id`, `notion_url`, and `last_synced` columns.
- CSV sync requires `mapping[]` plus `destination.kind` and `destination.id`. Legacy `fmToSync` is not supported for CSV rules.
- `syncIdColumn` is optional for CSV rules. When provided, that source column becomes the preferred create/update identity and is persisted into `dendron_id`.
- `--operation update` never creates new Notion pages. Rows without an existing match are skipped.
- `--columns` filters CSV mappings by `fromName` or `toName`, while still preserving sync metadata updates.
- If a CSV row does not provide `dendron_id` or `id`, the CLI generates a deterministic `dendron_id` from the rule name plus mapped source values.
- Multiple CSV mappings with `toType: body` are appended in mapping order, joined by a blank line.
- `toType: file/image` appends media blocks after the page body is synced.
- Sync replaces the page body, but preserves any NOTION_ONLY toggle blocks in Notion.
- The destination database must include `last_synced` (date) and `dendron_id` (rich_text or similar) properties.

Examples:

```bash
node dist/notion.js sync --from md
node dist/notion.js sync --from md ./notes/task.2025.12.28.finalize-trip.md
node dist/notion.js sync --from md --dry-run
node dist/notion.js sync --from md --rule task
node dist/notion.js sync --from md --rules-dir ./syncRules
node dist/notion.js sync --from csv ./exports/tasks.csv
node dist/notion.js sync --from csv --path ../exports
node dist/notion.js sync --from csv --operation update --columns Status,Priority --limit 10 ./exports/tasks.csv
```

CSV rule example:

```yaml
fnameTrigger: "task.csv-*"
syncIdColumn: external_id
mapping:
  - fromName: Name
    toName: Name
  - fromName: Summary
    toType: body
  - fromName: Screenshot
    toType: file/image
  - fromName: AssetPath
    process: "./processors/upload-file.js"
    toType: file/image
destination:
  kind: db
  id: "your-database-id"
```

CSV processor contract:

```ts
type ProcessFunction = (opts: {
  column: string;
  value: string;
  helper: {
    asBody(text: string): any;
    asFile(input: string | object): any;
    uploadFile(input: string | object, options?: { type?: "image" | "file" }): any;
  };
}) => any;
```

Processor notes:

- Processor paths are resolved relative to the rule file first.
- A processor file must export a single function.
- `helper.asBody()` returns a body fragment without requiring Notion-specific objects.
- `helper.asFile()` creates deferred file/image actions when you want to return them explicitly.
- `helper.uploadFile()` can either be returned or called imperatively inside a loop; any queued uploads are appended after the page is created or updated.
- Relative file paths returned by processors are resolved against the CSV file first, then the rule directory.

Imperative upload example:

```js
module.exports = (opts) => {
  const data = JSON.parse(opts.value);
  data.forEach((ent) => {
    if (ent && ent.url) {
      opts.helper.uploadFile(ent.url, { type: 'image' });
    }
  });
};
```

### `parse-block`

Parse a markdown block from standard input into structured `{ title, properties, body }` JSON.

Input format:

- First line: markdown heading with the title (for example, `## Some title`)
- Optional metadata lines: `- key: value`
- Blank line
- Body text

Example:

```bash
echo "## Weekend grocery reminder
- time: 08:25
- source: SMS

Please pick up apples, oats, and milk on the way home." | node dist/notion.js parse-block
```

Outputs:

```json
{
  "title": "Weekend grocery reminder",
  "properties": {
    "time": "08:25",
    "source": "SMS"
  },
  "body": "Please pick up apples, oats, and milk on the way home."
}
```


### `status`

Check Notion API connectivity by listing users.

Options:

- `--limit`: Maximum number of users to fetch. Default 1.

Examples:

```bash
node dist/notion.js status
node dist/notion.js status --limit 5
```

## Property value rules (for `create`)

- `title`, `rich_text`, `select`, `status`, `email`, `phone_number`, `url`: pass a single value.
- `number`: numeric string (for example, `42`).
- `date`: `YYYY-MM-DD` or ISO 8601.
- `multi_select`: comma-separated values (for example, `Tags="ops,infra"`).
- `checkbox`: `true` or `false`.
- `relation`: comma-separated Notion page IDs.

## Body limitations

Markdown is converted to paragraph blocks only. Headings, lists, and other block types are stored as plain paragraph text.

## Help and version

```bash
node dist/notion.js --help
node dist/notion.js --version
```
