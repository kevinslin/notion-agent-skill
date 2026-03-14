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

- `--operation`: `sync` creates or updates matched records; `update` only updates existing markdown notes or CSV rows.
- `--columns`: Limit processing to the listed source or target fields while still persisting sync metadata.
- `--limit`: Cap the number of records processed in a run, where one markdown file or one CSV row each count as one record.
- `--rule`: Run a specific rule (matches rule filename or `name` field).
- `--path`: Additional file or directory paths to scan (repeatable).
- `--dry-run`: Print planned actions without writing changes.
- `--rules-dir`: Directory containing `.yaml`/`.yml` rule files (defaults to `~/.notion-agents-skill/syncRules`).
- positional `path`: Provide a single file or directory after `sync` to only sync that target.

Notes:

- `notion sync` infers source type from the files you target. The old `--from` flag has been removed.
- With no positional target and no `--path`, markdown discovery uses `notes/` when present and otherwise `cwd`; CSV discovery uses `cwd`.
- If both markdown and CSV sources are discoverable in the default run, the command errors and asks for an explicit file, directory, or `--path`.
- Explicit directories and repeated `--path` values may intentionally contain both markdown and CSV sources, and the command will process both in one run.
- A markdown note is considered synced if it has a `notion_url` field in frontmatter.
- CSV rows persist sync metadata in `dendron_id`, `notion_url`, and `last_synced` columns.
- CSV sync requires `mapping[]` plus `destination.kind` and `destination.id`. Legacy `fmToSync` is not supported for CSV rules.
- `syncIdColumn` is optional for CSV rules. When provided, that source column becomes the preferred create/update identity and is persisted into `dendron_id`.
- `--operation update` never creates new Notion pages. Unsynced markdown notes and unmatched CSV rows are skipped.
- `--columns` filters markdown `fmToSync` entries by `name` or `target`, and filters CSV mappings by `fromName` or `toName`.
- If a CSV row does not provide `dendron_id` or `id`, the CLI generates a deterministic `dendron_id` from the rule name plus mapped source values.
- Multiple CSV mappings with `toType: body` are appended in mapping order, joined by a blank line.
- `toType: file/image` appends media blocks after the page body is synced.
- Sync replaces the page body, but preserves any NOTION_ONLY toggle blocks in Notion.
- The destination database must include `last_synced` (date) and `dendron_id` (rich_text or similar) properties.

Examples:

```bash
node dist/notion.js sync
node dist/notion.js sync ./notes/task.2025.12.28.finalize-trip.md
node dist/notion.js sync ./exports/tasks.csv
node dist/notion.js sync --dry-run
node dist/notion.js sync --rule task
node dist/notion.js sync --rules-dir ./syncRules
node dist/notion.js sync --path ./notes --path ./exports
node dist/notion.js sync --operation update --columns Status,Priority --limit 10 ./exports/tasks.csv
```

Single-note markdown sync:

- `node dist/notion.js sync ./notes/task.2025.12.28.finalize-trip.md` only syncs that one note.
- The CLI reads the note's YAML frontmatter and markdown body, matches exactly one markdown sync rule by `fname` frontmatter or by the filename stem, then creates or updates the target Notion page.
- On success, it writes `last_synced` back to frontmatter and stores the page URL in `notion_url` if needed.

Markdown sync syntax:

- A markdown rule must define `fnameTrigger`, `fmToSync[]`, and `destination.databaseId`.
- Each `fmToSync` entry starts with `name`, the frontmatter field to read.
- Use `target` to map that frontmatter field into a Notion property with a different name.
- Use `mode: append` for merge-style writes on properties that support it, such as `multi_select` and `relation`.
- Use `type: relation` with `databaseName` or `databaseId` to resolve relation values by page title instead of passing raw Notion IDs.
- `errorIfNotFound: true` makes relation sync fail when the related page does not exist. Otherwise the CLI creates missing relation pages during a real sync.

Markdown rule example:

```yaml
fnameTrigger: "task.*"
fmToSync:
  - name: title
    target: Name
  - name: proj
    target: Project
    type: relation
    databaseName: "Projects"
    errorIfNotFound: true
    mode: replace
destination:
  databaseId: "your-database-id"
```

How markdown sync works:

1. The CLI loads markdown rules from the rules directory, then filters them by `--rule` if you provided one.
2. It discovers markdown files from the positional target, explicit `--path` roots, or the default markdown roots when the run is not otherwise ambiguous.
3. Each note must have YAML frontmatter. The CLI matches `fnameTrigger` against `frontmatter.fname` when present, otherwise the filename stem.
4. If no rule matches, the note is skipped. If multiple rules match, the command errors.
5. The CLI treats `frontmatter.notion_url` as the page identity for updates. If `notion_url` is missing, markdown sync creates a new page in `--operation sync` and skips the note in `--operation update`.
6. It maps `fmToSync` fields into Notion properties, optionally filters those fields through `--columns`, and always syncs `dendron_id` from `frontmatter.dendron_id` or `frontmatter.id` plus `last_synced`.
7. It syncs the entire markdown body as paragraph blocks only. On updates, it replaces all existing blocks except toggle blocks titled `NOTION_ONLY`, which are preserved.
8. After a successful sync, it writes `last_synced` and `notion_url` back into the note frontmatter.

Markdown vs CSV:

- Markdown rules use `fmToSync` plus `destination.databaseId`. CSV rules use `mapping[]` plus `destination.kind` and `destination.id`.
- Markdown sync works at the file level and always syncs the note body. CSV sync works at the row level and only touches the body when a mapping or processor emits `toType: body` or `toType: file/image`.
- Markdown updates identify an existing page from `notion_url` only. CSV updates check `notion_url` first and then fall back to `dendron_id`.
- `--operation`, `--columns`, and `--limit` apply to both source types, but keep their existing CSV meanings and map onto markdown records by file and `fmToSync` entry.
- Markdown sync does not support per-field processors or file/image mappings. CSV sync supports both.

CSV sync syntax:

- A CSV rule must define `fnameTrigger`, `mapping[]`, and `destination`.
- `destination.kind` must be `db` and `destination.id` must be the destination Notion database ID.
- Each `mapping` entry starts with `fromName`, the CSV column to read.
- Use `toName` to map that column into a Notion property with a different name.
- Use `toType: body` to append the column value to the page body instead of a property.
- Use `toType: file/image` to append a file or image block after the body sync.
- Use `process` to run a custom JS transformer before mapping. The processor can return a property value, a body fragment, or deferred file uploads.
- `syncIdColumn` is optional. When present, that column becomes the preferred stable row identity and is copied into `dendron_id`.

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

How CSV sync works:

1. The CLI loads all CSV rules from the rules directory, then filters them by `--rule` if you provided one.
2. It discovers CSV files from the positional target, explicit `--path` roots, or the default CSV roots when the run is not otherwise ambiguous.
3. For each row, it chooses the rule by matching `fnameTrigger` against `row.fname` when present, otherwise the CSV filename stem.
4. If no rule matches, the row is skipped. If multiple rules match, the command errors.
5. The CLI computes `dendron_id` from `syncIdColumn`, else existing `dendron_id` or `id`, else a deterministic hash of the mapped values.
6. It looks for an existing Notion page by `notion_url` first, then by `dendron_id`.
7. Property mappings write into Notion properties. `toType: body` mappings are joined with blank lines into the page body.
8. `toType: file/image` mappings and processor uploads are appended as file or image blocks after the page body sync.
9. In `--operation sync`, rows create pages when no existing page is found. In `--operation update`, unmatched rows are skipped instead.
10. After a successful sync, the CLI writes `dendron_id`, `notion_url`, and `last_synced` back into the CSV file.

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
