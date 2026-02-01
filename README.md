# Notion skill

Notion skill and CLI that let you create pages, sync notes, and manage database metadata in a Notion workspace.
It works by providing a Codex skill definition plus a Node CLI in `scripts/notion` that talks to the Notion API.

## What it enables

- Create pages in Notion databases with structured properties and markdown bodies.
- Sync local notes into Notion using rule files.
- Cache database metadata for fast lookups.
- Parse markdown blocks into structured payloads for automation.

## Quickstart

```bash
cd scripts/notion
npm install
export NOTION_TOKEN=secret_xxx
node notion.js list-db --limit 5 --format table
```

If you install the local bin, you can replace `node notion.js` with `notion`.

## Setup

- Set `NOTION_TOKEN` (or `NOTION_API_KEY`) in the environment or a `.env` file.
- Run `node notion.js sync-meta` once to create `$HOME/.notion-cache.production.json`.

## Skill usage

Use this skill when you want to:

- Add entries to Notion databases.
- Create new Notion pages with structured data.
- Save content from Dendron notes to Notion.
- Track daily stories, tasks, lessons, or other personal data in Notion.

## Common commands

```bash
# List databases
node notion.js list-db --limit 10 --format table

# Create a page
node notion.js create --database-id <db-id> --properties Name="Daily note" --properties Date=2026-01-29

# Sync metadata cache
node notion.js sync-meta

# Sync notes using rules
node notion.js sync --dry-run
```

Full CLI reference lives in `scripts/notion/USAGE.md`.

## add-block shortcut

Create a database entry from a single markdown block.

1. Confirm the target database and the block content.
2. Parse the block into `{ title, properties, body }` using `parse-block` (prefer `printf` piping).
3. Use `create` with the parsed output to create the entry.

```bash
printf "%s" "## Weekend grocery reminder
- time: 08:25
- source: SMS

Please pick up apples, oats, and milk on the way home." | node notion.js parse-block
```

## Tests

```bash
cd scripts/notion
npm test
```
