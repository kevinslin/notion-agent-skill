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

Run `notion sync` from the workspace root (where `notes/` live). Use `--rules-dir` to point at a different rules directory.
