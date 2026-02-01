# Execution Plan: Notion Sync Integration Tests

**Date:** 2026-02-01
**Status:** Completed

---

## Goal

Add integration tests for the `notion sync` command that cover single-note sync and full notes-folder sync against the test Notion workspace, ensuring required database properties exist for sync.

---

## Context

### Background
The sync command is implemented and unit-tested, but integration coverage is missing. The plan for `notion sync` calls for validating behavior via integration tests when Notion credentials are available.

### Current State
- Integration tests live under `scripts/notion/integ` and use `.env.test` for credentials.
- `notion sync` reads `syncRules/` and scans `notes/` by default.
- Test database setup script does not yet enforce sync-required properties (`dendron_id`, `last_synced`).

### Constraints
- CommonJS Node project using Jest.
- Integration tests must hit the real Notion API and use the test workspace.
- CLI uses `process.cwd()` to locate `syncRules` and notes.

---

## Technical Approach

### Architecture/Design
- Add `integ/sync.test.js` that:
  - Creates a temporary workspace with `syncRules/` and `notes/`.
  - Runs `node notion.js sync` via `child_process` with `cwd` pointing at the temp workspace.
  - Verifies updated frontmatter (`notion_url`, `last_synced`) and that pages exist in Notion.

### Technology Stack
- Jest integration tests.
- `@notionhq/client` for verification.
- Existing `utils` helpers for frontmatter parsing and Notion ID extraction.

### Integration Points
- Notion API: `pages.create`, `pages.retrieve` via CLI flow.
- CLI entrypoint `notion.js`.

### Design Patterns
- Use temp directories for isolation.
- Reuse existing test env loading (`loadEnv`).

### Important Context
- Sync requires `dendron_id` (rich_text) and `last_synced` (date) properties in the destination database.

---

## Steps

### Phase 1: Implement Integration Tests
- [x] Add `integ/sync.test.js` covering:
  - Sync a single note via positional target.
  - Sync all notes in a `notes/` folder.
- [x] Use test workspace credentials from `.env.test`.

### Phase 2: Test Database + Docs Updates
- [x] Update `integ/setupTestDatabase.js` to include `dendron_id` and `last_synced` properties.
- [x] Update relevant docs/spec status to reflect integration coverage.

**Dependencies between phases:**
- Phase 2 can follow Phase 1; tests depend on database properties being present.

---

## Testing

- `npx jest integ/sync.test.js`

---

## Dependencies

### External Services/APIs
- Notion API: create/update/retrieve pages.

### Libraries/Packages
- `@notionhq/client`, `jest` (already in repo).

### Tools/Infrastructure
- Notion integration token in `.env.test`.

### Access Required
- [ ] `NOTION_TOKEN` (or `NOTION_API_KEY`) in `.env.test`.
- [ ] `TEST_DATABASE_ID` in `.env.test`.

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| Test database missing sync properties | High | Medium | Extend setup script to ensure properties exist |
| Notion API rate limits | Medium | Low | Keep tests minimal, use small note counts |
| Flaky tests due to network latency | Medium | Low | Increase Jest timeouts |

---

## Questions

### Technical Decisions Needed
- [x] Use `TEST_DATABASE_ID` for sync tests (no separate sync DB required).

### Clarifications Required
- [x] Integration tests should run via CLI to cover note discovery and rule loading.

---

## Success Criteria

- [x] Integration tests for `notion sync` cover single-note and notes-folder sync.
- [x] Tests run against the test Notion workspace and pass reliably.
- [x] Test database setup script ensures required sync properties.

---

## Notes

- Extends the `2026-01-31-notion-sync-command` plan with integration coverage.
