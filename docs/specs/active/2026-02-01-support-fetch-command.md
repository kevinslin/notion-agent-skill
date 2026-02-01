# Execution Plan: Support Fetch Command

**Date:** 2026-02-01
**Status:** In Progress

---

## Goal

Implement a new `fetch` CLI command that queries Notion databases by ID or name, supports wildcard query + advanced filters, and outputs results as JSON or Markdown with title, properties, and body content.

---

## Context

### Background
Issue #5 requests a `fetch` command with query + filter support and multiple output formats. The codebase already includes a robust filter parser (`utils/filter.js`) and existing CLI commands in `scripts/notion/commands`.

### Current State
- CLI entry point `scripts/notion/notion.js` wires commands via yargs.
- Database querying is not exposed via CLI.
- Filter parsing is implemented and tested.
- Metadata cache is written by `sync-meta` to `~/.notion-cache.{env}.json`, but no helper exists to resolve DB names.

### Constraints
- Use existing command/module pattern.
- Must work with `NOTION_TOKEN` / `.env` loading.
- Keep output formats CLI-friendly and deterministic.
- Avoid heavy markdown conversion; minimal block-to-text rendering is acceptable.

---

## Technical Approach

### Architecture/Design
- Add a new command module `commands/fetch.js`.
- Resolve database by `--database-id` or `--database-name` (name lookup via cache if present, fallback to Notion API).
- Fetch database schema to determine title property and to validate/parse filters.
- Construct Notion `databases.query` with optional `filter`, `page_size`, and pagination.
- Collect page content by reading block children and flattening to text/markdown-ish lines.

### Technology Stack
- Node.js (CommonJS)
- @notionhq/client
- Existing filter utilities in `utils/filter.js`

### Integration Points
- `scripts/notion/notion.js` (command registration)
- `scripts/notion/utils` (filter parser, helpers)
- `scripts/notion/USAGE.md` and `README.md` for docs

### Design Patterns
- Follow existing command module pattern (`{ command, describe, builder, handler }`).
- Keep data formatting logic in command module unless it becomes reusable.

### Important Context
- Title property is determined by `schema.type === "title"`.
- Filter parsing requires a property schema (name -> type) from `databases.retrieve`.
- Notion block children are paginated; must loop through `next_cursor`.

---

## Steps

### Phase 1: Command and Data Retrieval
- [x] Create `commands/fetch.js` with yargs options:
  - `--database-id` or `--database-name` (one required)
  - `--query` (wildtext, applied to title property via `contains`)
  - `--filter` (advanced filter string parsed by `parseFilter`)
  - `--output` (`json` default, `md` alternative)
  - `--limit` (page size / max results)
  - optional `--env` for cache file selection
- [x] Implement database resolution by ID or name (cache lookup, fallback to API list-db).
- [x] Fetch schema, compute title property name.
- [x] Build Notion query filter:
  - If `query` provided, generate title `contains` filter.
  - If `filter` provided, parse into Notion filter.
  - If both provided, combine with `and`.

### Phase 2: Output Formatting
- [x] For each page, compute:
  - `id`, `title` (from title property)
  - `properties` (raw Notion properties or simplified values)
  - `body` (flattened text from block children)
- [x] Support JSON output (array of page objects).
- [x] Support Markdown output (one entry per page, separated by `---`):
  ```
  # Title
  - properties: { ... }

  Body text...
  ```

### Phase 3: Wiring and Docs
- [x] Register the command in `notion.js`.
- [x] Update `scripts/notion/USAGE.md` with fetch docs + examples.
- [x] Update root `README.md` if appropriate.

**Dependencies between phases:**
- Phase 2 depends on Phase 1 for schema + query results.
- Phase 3 depends on Phase 2 to reflect actual behavior.

---

## Testing

- Add unit tests for page formatting helpers (title extraction, block-to-text flattening) if logic is non-trivial.
- Run unit tests: `npm run test:unit`.
- (Optional) Integration tests if credentials are available: `npm run test:integ`.

---

## Dependencies

### External Services/APIs
- Notion API (databases.query, databases.retrieve, blocks.children.list)

### Libraries/Packages
- @notionhq/client (existing)
- yargs (existing)

### Tools/Infrastructure
- None beyond existing CLI environment

### Access Required
- [ ] NOTION_TOKEN for real API usage

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| DB name lookup ambiguous or cache missing | Med | Med | Fallback to API list; error with available matches |
| Block rendering incomplete for complex blocks | Low | Med | Document limitations; implement basic rich_text extraction |
| Filter + query combined incorrectly | Med | Low | Add explicit `and` combine logic + tests |

---

## Questions

### Technical Decisions Needed
- [x] JSON `properties` will be a simplified map (plain values); unknown types fall back to raw.
- [x] Markdown output will include all properties as a single JSON object line.
- [x] `--query` searches only the title property using `contains`.

### Clarifications Required
- [x] Support `--filter` with alias `--filters` to match the issue wording.
- [x] Separate multiple markdown results with `---`.

### Research Tasks
- [x] CLI option naming follows existing yargs patterns; add alias for plural spelling.

---

## Success Criteria

- [ ] `node notion.js fetch --database-id <id>` returns JSON results with id/title/properties/body.
- [ ] `--database-name` works when cache is present and via API fallback.
- [ ] `--query` and `--filter` can be combined and return expected results.
- [ ] `--output md` renders readable markdown with title + body.
- [ ] Documentation updated with examples and option descriptions.

---

## Notes

- Plan created after reviewing recent commits (filter parser landed in 2026-02-01).
