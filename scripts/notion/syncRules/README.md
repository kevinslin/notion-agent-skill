# Sync Rules

Place one or more `.yaml` (or `.yml`) files in your `~/.notion-agents-skill/syncRules` directory. Each file should define a sync rule object (or list of objects) that matches the `SyncRule` shape.

Markdown sync example:

```yaml
fnameTrigger: "task.*"
fmToSync:
  - name: title
  - name: proj
    target: tags
    mode: append
destination:
  databaseId: "your-database-id"
```

Markdown relation fields (by page title):

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

CSV sync example:

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
  - fromName: Attachment
    process: "./processors/upload-file.js"
    toType: file/image
destination:
  kind: db
  id: "your-database-id"
```

Example CSV processor:

```js
module.exports = ({ value, helper }) => {
  if (!value) {
    return null;
  }

  return helper.uploadFile(value);
};
```

Example CSV processor with imperative uploads:

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

Notes:
- Markdown sync still uses `fmToSync` plus `destination.databaseId`.
- CSV sync uses `mapping` plus `destination.kind` and `destination.id`.
- `syncIdColumn` is optional for CSV rules and, when set, becomes the preferred row identity for deciding create vs update.
- `notion sync --from csv --operation update` only updates existing pages and skips rows that do not already match.
- `--columns` filters CSV updates by `fromName` or `toName`, so unspecified mapped columns are left untouched in Notion.
- `--limit` caps the total number of CSV rows processed across the run.
- `destination.kind: page` is reserved for future support and currently rejected.
- CSV `toType` supports `string`, `number`, `body`, and `file/image`.
- If `toName` is omitted for CSV, the CLI uses `fromName`.
- CSV processor files are resolved relative to the rule file first and must export a single function.
- CSV processors receive `helper.asBody()`, `helper.asFile()`, and `helper.uploadFile()` so they do not need direct Notion dependencies.
- `helper.uploadFile()` supports `helper.uploadFile(input, { type: 'image' | 'file' })` and can be called imperatively without returning the marker.
- If `syncIdColumn` is not set and a CSV row lacks `dendron_id` and `id`, the CLI derives a stable `dendron_id` from the rule name plus mapped values.
- `type: relation` enables name-based relation resolution.
- `databaseName` (or `databaseId`) identifies the related database. The CLI uses the Notion database list/cache to resolve the ID.
- `errorIfNotFound` defaults to `false` (missing relation targets are created).
- Relation values can be comma-separated to link multiple pages.

Run `notion sync` from the workspace root (where `notes/` live). Use `--rules-dir` to point at a different rules directory.
