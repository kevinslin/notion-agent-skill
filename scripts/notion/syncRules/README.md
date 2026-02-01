# Sync Rules

Place one or more `.js` files in this directory. Each file should export a sync rule object (or array of objects) that matches the `SyncRule` shape.

Example:

```js
module.exports = {
  fnameTrigger: 'task.*',
  fmToSync: [
    { name: 'title' },
    { name: 'proj', target: 'tags', mode: 'append' },
  ],
  destination: {
    databaseId: 'your-database-id',
  },
};
```

Run `notion sync` from the workspace root (where `syncRules/` and `notes/` live).
