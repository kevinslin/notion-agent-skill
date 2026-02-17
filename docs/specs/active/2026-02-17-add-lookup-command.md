# Execution Plan: Add Lookup Command

**Date:** 2026-02-17
**Status:** Completed

---

## Goal

Add a CLI command:

```bash
notion lookup [query] --filter [filter-options] --sort [sorting-options]
```

that calls Notion `POST /v1/search` to search by title/query text, with optional filter and sort controls.

---

## Context

### Background

The CLI already supports database-scoped fetches (`fetch`) and structured filters for database queries, but it does not support global Notion search. A `lookup` command fills this gap by supporting discovery across pages and databases/data sources through the Search API.

### Current State

- CLI commands are modular under `scripts/notion/commands/*.js` and registered in `scripts/notion/notion.js`.
- Existing `fetch` command supports `--query`, `--filter`, `--output`, and pagination/limit patterns in a database-scoped flow.
- There is no command that calls `client.search(...)`.
- CLI docs in `scripts/notion/USAGE.md` do not include a search-by-title/global lookup command.

### Constraints

- Keep command implementation in CommonJS style consistent with existing commands.
- Maintain yargs option conventions used by existing commands (`--limit`, `--output`, examples).
- Use Notion Search API contract:
  - `query` (string)
  - `filter` with `property: "object"` and `value: "page" | "data_source"` (or legacy `"database"` depending API version)
  - `sort` with `timestamp: "last_edited_time"` and `direction: "ascending" | "descending"`
- Respect search behavior limitations (not exhaustive/index-lag caveats from Notion docs).

### Context Triage Gate (Required)

| Value | Source of truth | Representation | Initialization point | Snapshot/capture point | First consumer | Ordering valid? |
| --- | --- | --- | --- | --- | --- | --- |
| CLI query | positional arg `[query]` | string | yargs parse | `argv` in `lookup` handler | Notion `search` body `query` | yes |
| Search filter | `--filter` string | parsed object | `parseLookupFilter()` | request body build | Notion `search` body `filter` | yes |
| Search sort | `--sort` string | parsed object | `parseLookupSort()` | request body build | Notion `search` body `sort` | yes |
| Pagination cursor | `--start-cursor` arg + API `next_cursor` | string/null | CLI parse or API response | in pagination loop | next `search` call | yes |
| Result type mapping | API response `object` + `results` | simplified local result shape | response handling | formatting step | stdout formatter | yes |

Answer to ordering check: values are initialized before request payload is captured and consumed.

---

## Technical Approach

### Architecture/Design

Add a new command module `scripts/notion/commands/lookup.js` that:

1. Parses positional `query` and optional `--filter` / `--sort`.
2. Builds a `client.search` payload.
3. Executes paginated search requests until limit/cursor boundary.
4. Formats result output for CLI consumption.

The command will remain read-only and independent from database schema introspection.

### Command Contract (Proposed)

- `lookup [query]`:
  - Optional positional search query (defaults to empty query if omitted; returns recent/shared content).
- `--filter`:
  - String options for Search API filter.
  - Proposed syntax: `object:<value>` where `<value>` is `page` or `data_source`.
  - Backward-compat fallback: accept `object:database` and map to API-compatible value when needed.
- `--sort`:
  - String options for Search API sort.
  - Proposed syntax: `last_edited_time:<direction>` where `<direction>` is `ascending` or `descending`.
- `--limit`:
  - Max results returned to stdout.
- `--start-cursor`:
  - Optional cursor to continue from a previous run.
- `--output`:
  - `json` (default) or `table`.

### Output Shape (JSON)

Each result object should include minimal stable fields:

- `id`
- `object` (`page` or `database`/`data_source` depending API version response)
- `title`
- `url`
- `last_edited_time`
- `parent` (condensed parent descriptor)

### Parsing Strategy

- Add lightweight parsers in `lookup.js` (or extracted to `utils/search.js` if reuse appears):
  - `parseLookupFilter(raw)`
  - `parseLookupSort(raw)`
- Keep parser grammar intentionally narrow to avoid confusion with `fetch --filter` language.
- Fail fast with actionable errors for invalid filter/sort syntax.

### Pagination Strategy

- Use Notion `page_size` in each call (bounded by API limits).
- Continue while `has_more` and `results.length < limit`.
- If no `limit` is provided, fetch all accessible matches for the query window.

### Technology Stack

- Node.js (CommonJS)
- `@notionhq/client` (existing dependency)
- yargs (existing dependency)

### Integration Points

- `scripts/notion/notion.js`:
  - register new `lookup` command module
- `scripts/notion/USAGE.md`:
  - add command description, options, examples
- repo root `README.md` (optional):
  - add one usage example for discoverability
- Tests:
  - `scripts/notion/tests/lookup.test.js`
  - `scripts/notion/integ/lookup.test.js`

### Design Patterns

- Follow existing command module interface:
  - `command`, `describe`, `builder`, `handler`
- Reuse env/bootstrap pattern used by `fetch` and `create`.
- Keep output formatting deterministic for snapshot tests.

### Important Context

- Search API is not intended to be a complete/export index and may lag shortly after edits/shares.
- Search returns only resources shared with the integration.
- Search supports filtering by object type only (not full property-based filtering like database query).

---

## Steps

### Phase 1: Command Scaffolding and Option Parsing

- [x] Create `scripts/notion/commands/lookup.js`
- [x] Add yargs command signature: `lookup [query]`
- [x] Implement parser helpers for `--filter` and `--sort`
- [x] Validate allowed filter/sort values and produce clear error messages

### Phase 2: Search Execution and Output Formatting

- [x] Implement `client.search(...)` request builder
- [x] Add pagination loop with `--limit` and `--start-cursor`
- [x] Implement `json` and `table` output modes
- [x] Normalize result title extraction for page/database/data_source cases

### Phase 3: Wiring and Documentation

- [x] Register command in `scripts/notion/notion.js`
- [x] Document command in `scripts/notion/USAGE.md`
- [x] Add examples matching requested syntax

### Phase 4: Test Coverage

- [x] Unit tests for filter/sort parser and response formatting
- [x] Integration tests for query-only lookup and filtered/sorted lookup
- [x] Add snapshots for stable output behavior

### Phase Dependencies

- Phase 2 depends on Phase 1 parser contract.
- Phase 3 depends on Phase 2 finalized flags/output behavior.
- Phase 4 runs after Phase 2 but should gate completion of Phase 3 docs wording.

---

## Testing

Integration tests:

- `lookup "seeded title fragment"` returns results containing expected seeded page title.
- `lookup --filter object:page` excludes non-page objects.
- `lookup --sort last_edited_time:descending` returns non-increasing edit timestamps.
- Pagination honors `--limit` and `--start-cursor`.

Unit tests:

- `parseLookupFilter` accepts valid values and rejects invalid forms.
- `parseLookupSort` accepts valid values and rejects invalid forms.
- Result normalizer extracts title/url/object safely for mixed result types.

Manual validation:

- Run `node notion.js lookup "sample"` and confirm readable output.
- Run filtered and sorted variants from CLI examples.
- Verify command help text: `node notion.js lookup --help`.

---

## Dependencies

### External Services or APIs

- Notion Search API: `POST /v1/search` - https://developers.notion.com/reference/post-search
- Search limitations: https://developers.notion.com/reference/search-optimizations-and-limitations

### Libraries or Packages

- `@notionhq/client` (`^2.2.15`) - API client
- `yargs` (`^17.7.2`) - CLI argument parsing

### Tools or Infrastructure

- Jest unit/integration configs already present in `scripts/notion`

### Access Required

- [ ] `NOTION_TOKEN` / `NOTION_API_KEY`
- [ ] Shared test content in workspace accessible to integration

---

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
| --- | --- | --- | --- |
| API-version mismatch around `database` vs `data_source` filter values | Med | Med | Support both in CLI parser and map based on response/version behavior; document assumptions |
| Users expect property-level filtering like `fetch --filter` | Med | High | Keep `lookup --filter` syntax narrow (`object:*`), and document difference prominently |
| Search indexing lag causes flaky integration tests | Med | Med | Add retry/backoff with bounded wait in integration tests |
| Result title extraction differs by object type | Low | Med | Add robust normalizer with fixture coverage for page and database/data_source |

---

## Questions

### Technical Decisions Needed

- [x] `lookup` should be global search (not database-scoped).
- [x] `--filter` should be Search API object filter, not existing database filter language.
- [x] `--sort` should expose Search API timestamp direction controls.

### Clarifications Required

- [x] Should `lookup` default output be `json` or `table` for interactive use?
  - json
- [x] Should we add a dedicated `--type` alias for common filter use (`page`/`data_source`)?
  - no (kept surface minimal; `--filter object:<value>` is sufficient)

### Research Tasks

- [x] Confirm exact `post-search` filter/sort body shape from official docs.
- [x] Confirm search limitations that affect behavior and test strategy.

---

## Success Criteria

- [x] `notion lookup [query]` executes `POST /v1/search` and returns stable output.
- [x] `--filter` and `--sort` options map correctly to Notion Search API.
- [x] CLI docs include examples with filter and sort usage.
- [x] Unit + integration tests cover parser, sorting/filtering behavior, and pagination.
- [x] Command behavior is clearly differentiated from `fetch` database query behavior.

---

## Notes

- Simplification: this plan intentionally does not introduce property-level search filters, because Search API supports object-type filtering only.
- Assumption: current CLI keeps existing Notion SDK version; compatibility handling for `database`/`data_source` terminology is part of parser normalization.
- Validation run:
  - `npm run test:unit`
  - `npm run test:integ -- --runTestsByPath integ/lookup.test.js`
- Implementation added retry logic in integration tests to handle Notion search indexing delay.

## Manual Notes 

[keep this for the user to add notes. do not change between edits]

## Changelog
- 2026-02-17: Created feature spec for `lookup` command using Notion Search API with optional filter/sort options (019c695b-0519-7d80-bac3-fef2d1b0c431)
- 2026-02-17: Marked implementation complete and documented validation outcomes (019c695b-0519-7d80-bac3-fef2d1b0c431)
