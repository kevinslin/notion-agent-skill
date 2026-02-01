# Execution Plan: Support Relation Fields in Sync

**Date:** 2026-02-01
**Status:** In Progress

---

## Goal

Enable `notion sync` to resolve relation properties by name via `fmToSync` config, creating or erroring on missing relation targets as configured.

---

## Context

### Background
Sync rules currently only support relation properties by providing Notion page IDs. Issue #1 requests name-based relation syncing with optional auto-create and database lookup by name.

### Current State
- `commands/sync.js` builds properties synchronously and treats relation values as comma-separated IDs.
- Rule config supports `fmToSync` with `name`, `target`, and `mode` but no relation resolution.
- Database schema caching exists but only stores property types and title property name.

### Constraints
- JavaScript (CommonJS) codebase, Node + Jest.
- Notion API calls should be minimized; use caching where possible.
- Avoid breaking existing relation-by-ID behavior.

---

## Technical Approach

### Architecture/Design
- Make `buildProperties` async so relation resolution can query Notion.
- Add relation resolution helpers in `commands/sync.js` to:
  - Resolve relation database IDs by name (via existing `resolveDatabaseId`).
  - Fetch relation database title property name.
  - Query for an existing page by title; optionally create if missing.
  - Build relation property values (append/replace) with caching.

### Technology Stack
- Node.js, @notionhq/client, Jest.

### Integration Points
- `commands/sync.js`: main sync pipeline.
- `commands/fetch.js`: reuse `resolveDatabaseId` for databaseName lookup.
- `syncRules/README.md`: document new relation fields.

### Design Patterns
- Cache maps for database IDs, schemas, and relation page IDs.
- Preserve existing property coercion for non-relation fields.

### Important Context
- Relation config is opt-in via `fmToSync` options (e.g., `type: 'relation'`, `databaseName`, `errorIfNotFound`).
- If `databaseName` is omitted, attempt to use the relation database ID from the schema when available.

---

## Steps

### Phase 1: Plan & Setup
- [x] Add gitignore entries for `*-progress.md` and `*-learnings.md`.
- [x] Create progress/learnings files for this plan.

### Phase 2: Implement Relation Resolution
- [x] Extend schema cache to include relation database IDs.
- [x] Add helpers to resolve relation database IDs and page IDs by title (with caching).
- [x] Update `buildProperties`/`syncNote` to use async relation resolution when configured.
- [x] Preserve existing behavior for non-relation properties and relation-by-ID.

### Phase 3: Docs & Tests
- [x] Update `syncRules/README.md` with relation field example and options.
- [x] Add/adjust tests if feasible (unit tests for helpers; integration tests if database supports relation).

**Dependencies between phases:**
- Phase 2 depends on Phase 1.
- Phase 3 depends on Phase 2.

---

## Testing

- `npm run test:unit`
- (Optional) `npm run test:integ` if environment is configured and relation property is available.

---

## Dependencies

### External Services/APIs
- Notion API: database search/query, page create.

### Libraries/Packages
- @notionhq/client
- jest

### Tools/Infrastructure
- Notion CLI repo scripts.

### Access Required
- [ ] NOTION_TOKEN in env for integration tests (optional).
- [ ] TEST_DATABASE_ID configured for integration tests (optional).

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| Extra API calls slow sync | Med | Med | Cache database IDs, schemas, and relation page IDs |
| Ambiguous matches for relation title | Med | Low | Throw error if multiple matches found |
| Schema mismatch (non-relation property) | High | Low | Validate property type before relation handling |

---

## Questions

### Technical Decisions Needed
- [ ] None (proceeding with defaults and schema-based inference).

### Clarifications Required
- [ ] None (user requested no input).

### Research Tasks
- [ ] None.

---

## Success Criteria

- [ ] `notion sync` resolves relation values by name when configured.
- [ ] Missing relation targets are created unless `errorIfNotFound` is true.
- [ ] Existing relation-by-ID behavior still works.
- [ ] Documentation updated.
- [ ] Tests pass or are documented if skipped.

---

## Notes

- Proceeding without user input per request.
