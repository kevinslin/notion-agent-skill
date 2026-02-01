# Execution Plan: Notion Sync Command

**Date:** 2026-01-31
**Status:** In Progress

---

## Goal

Implement a `notion sync` command that syncs local Dendron-style notes to Notion databases using configurable `syncRules`, including property mapping, body syncing with NOTION_ONLY preservation, and frontmatter updates (`notion_url`, `last_synced`).

---

## Context

### Background
The CLI currently supports `create`, `list-db`, `sync-meta`, `parse-block`, and `status`. There is no sync command for Dendron notes, but the workflow needs a rule-based sync that maps frontmatter to Notion properties and keeps Notion-only content intact.

### Current State
- Notes are expected to be markdown files with YAML frontmatter (Dendron format).
- Property coercion and markdown-to-paragraph conversion exist in `utils/helpers.js`.
- No sync rules directory or sync command yet.

### Constraints
- Node/CommonJS codebase using `@notionhq/client`, `js-yaml`, and `yargs`.
- Must preserve content inside NOTION_ONLY toggle blocks in Notion.
- Must update note frontmatter with `notion_url` (on first sync) and `last_synced` (always).

---

## Technical Approach

### Architecture/Design
- Add `commands/sync.js` with a rule-based sync pipeline:
  1) Load rules from `~/.notion-agents-skill/syncRules/*.yaml` (or `.yml`).
  2) Discover note files (default to `notes/` if present, else `cwd`).
  3) Parse YAML frontmatter + body.
  4) Match notes to rules via `fnameTrigger` wildcard.
  5) For each match: create or update Notion page, sync properties + body.
  6) Write updated frontmatter back to disk.

### Technology Stack
- `js-yaml` for frontmatter parsing/serialization.
- Existing Notion helpers (`coerceValueForPropertyType`, `markdownToParagraphBlocks`).

### Integration Points
- Notion API: `databases.retrieve`, `pages.create`, `pages.update`, `blocks.children.list`, `blocks.children.append`, `blocks.update` (archive).
- CLI entrypoint `notion.js` for new command registration.
- `USAGE.md` for documentation.

### Design Patterns
- Rule-based strategy for note type handling (one rule per note type).
- Cached database schema per destination to avoid repeated retrievals.

### Important Context
- `last_synced` and `dendron_id` must always be synced to Notion.
- Mode handling: `append` vs `replace` only applies to multi_select.
- Preserve NOTION_ONLY toggle blocks during body replacement.

---

## Steps

### Phase 1: Rule Loading + Note Discovery
- [x] Add YAML rule loader (supports single rule or array export, derives rule name from filename).
- [x] Implement note discovery (scan `notes/` if present, else `cwd`, ignoring `node_modules`, `.git`).
- [x] Implement frontmatter parser/serializer (YAML block + body extraction, round-trip updates).

### Phase 2: Sync Engine
- [x] Implement rule matching with wildcard `fnameTrigger` against frontmatter `fname` or filename stem.
- [x] Build property payloads from frontmatter + mandatory fields (`last_synced`, `dendron_id`).
- [x] Create vs update flow based on `notion_url`.
- [x] Implement append/replace for multi_select by merging existing property values on update.
- [x] Implement body sync: archive existing blocks except NOTION_ONLY toggles; append new blocks in chunks.

### Phase 3: CLI + Docs + Tests
- [x] Add `sync` command to `notion.js` and update `USAGE.md` with usage + examples.
- [x] Add unit tests for frontmatter parsing, rule matching, and property merge helpers.
- [x] Validate behavior manually or via integration tests if Notion credentials are available.

**Dependencies between phases:**
- Phase 2 depends on Phase 1 utilities.
- Phase 3 depends on Phase 2 core sync flow.

---

## Testing

- Unit tests for:
  - Frontmatter parsing/serialization round-trip.
  - Wildcard rule matching.
  - Multi-select append merge logic.
- Manual smoke test for `notion sync` (requires Notion token and rule config).

---

## Dependencies

### External Services/APIs
- Notion API: page create/update and block operations.

### Libraries/Packages
- `js-yaml` (already present).

### Tools/Infrastructure
- None beyond existing Node toolchain.

### Access Required
- [ ] NOTION_TOKEN available in env for manual/integration testing.

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| Body sync deletes Notion-only content | High | Low | Detect and preserve NOTION_ONLY toggle blocks before archiving | 
| Rule matching unintentionally syncs wrong notes | Medium | Medium | Require explicit `fnameTrigger` matches and log skipped/ambiguous files |
| Notion API rate limits | Medium | Low | Cache database schema; batch block appends |

---

## Questions

### Technical Decisions Needed
- [x] What is the required shape of `destination` in rules (e.g., `{ databaseId }` only, or additional config)?
  - Answer: `destination.databaseId` is sufficient for now.
- [x] Should sync scan `notes/` by default, or require a root/path flag?
  - Answer: scan `notes/` by default; additional paths may be provided.

### Clarifications Required
- [x] Should a note match multiple rules, or should conflicts be errors?
  - Answer: treat as error for now.
- [x] Expected format for `last_synced` in Notion (date vs text)?
  - Answer: Notion date property.

---

## Success Criteria

- [ ] `notion sync` command loads rules and syncs matching notes.
- [ ] Notes with `notion_url` update existing pages; otherwise pages are created and `notion_url` is added.
- [ ] `last_synced` frontmatter is written on every sync and synced to Notion.
- [ ] NOTION_ONLY toggle blocks remain intact after sync.
- [ ] Usage docs reflect the new command.

---

## Notes

- Plan confirmed: `destination.databaseId` required; sync scans `notes/` by default with optional extra paths; rule conflicts are errors; `last_synced` maps to a Notion date property.
