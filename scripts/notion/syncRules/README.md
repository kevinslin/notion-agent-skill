# Sync Rules

Place one or more `.yaml` (or `.yml`) files in your `~/.notion-agents-skill/syncRules` directory. Each file should define a sync rule object (or list of objects) that matches the `SyncRule` shape.

Example:

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

Relation fields (by page title):

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

Notes:
- `type: relation` enables name-based relation resolution.
- `databaseName` (or `databaseId`) identifies the related database. The CLI uses the Notion database list/cache to resolve the ID.
- `errorIfNotFound` defaults to `false` (missing relation targets are created).
- Relation values can be comma-separated to link multiple pages.

Run `notion sync` from the workspace root (where `notes/` live). Use `--rules-dir` to point at a different rules directory.
