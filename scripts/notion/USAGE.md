# Notion CLI usage guide

Notion CLI creates pages, syncs notes, and syncs database metadata from your Notion workspace.
It uses the official Notion API and reads your integration token from the environment or a `.env` file.

Commands below use `node notion.js`. If you have a local bin set up, replace that with `notion`.

## Quickstart

```bash
npm install
export NOTION_TOKEN=secret_xxx
node notion.js list-db --limit 5 --format table
```

## Authentication

- Set `NOTION_TOKEN` (or `NOTION_API_KEY`) in your environment or `.env`.
- If you run inside a `kevin-garden` workspace, the CLI loads `kevin-garden/.env` by default and `kevin-garden/.env.test` when `NODE_ENV=test`.

Example `.env`:

```bash
NOTION_TOKEN=secret_xxx
```

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
node notion.js create --database-id <db-id> --properties Name="Daily note" --properties Date=2026-01-29
node notion.js create --database-id <db-id> --properties Name="Release notes" --bodyFromTextFile ./notes.md
```

### `list-db`

List all databases accessible to the integration.

Options:

- `--limit`: Maximum number of databases to return. Default 100.
- `--format`: Output format: `json` or `table`. Default `json`.

Examples:

```bash
node notion.js list-db
node notion.js list-db --limit 10 --format table
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
node notion.js fetch --database-id <db-id>
node notion.js fetch --database-name "Tasks" --query "urgent"
node notion.js fetch --database-id <db-id> --filters "Status:equals:Done" --output md
```

### `sync-meta`

Sync database metadata and cache it locally.

Options:

- `--limit`: Maximum number of databases to sync.
- `--env`: `production` or `test` (controls cache filename). Default is `production` unless `NODE_ENV=test`.

Examples:

```bash
node notion.js sync-meta
node notion.js sync-meta --env test --limit 10
```

### `sync`

Sync local notes to Notion using YAML rule files in `~/.notion-agents-skill/syncRules/`.

Options:

- `--rule`: Run a specific rule (matches rule filename or `name` field).
- `--path`: Additional file or directory paths to scan (repeatable).
- `--dry-run`: Print planned actions without writing changes.
- `--rules-dir`: Directory containing `.yaml`/`.yml` rule files (defaults to `~/.notion-agents-skill/syncRules`).
- positional `path`: Provide a single file or directory after `sync` to only sync that target.

Notes:

- Notes are discovered under `notes/` by default if it exists, otherwise the current working directory.
- A note is considered synced if it has a `notion_url` field in frontmatter.
- Sync replaces the page body, but preserves any NOTION_ONLY toggle blocks in Notion.
- The destination database must include `last_synced` (date) and `dendron_id` (rich_text or similar) properties.

Examples:

```bash
node notion.js sync
node notion.js sync ./notes/task.2025.12.28.finalize-trip.md
node notion.js sync --dry-run
node notion.js sync --rule task
node notion.js sync --rules-dir ./syncRules
node notion.js sync --path ../notes-archive
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

Please pick up apples, oats, and milk on the way home." | node notion.js parse-block
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
node notion.js status
node notion.js status --limit 5
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
node notion.js --help
node notion.js --version
```
