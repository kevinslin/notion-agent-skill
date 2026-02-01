# Execution Plan: Split Jest Configs

**Date:** 2026-02-01
**Status:** Completed

---

## Goal

Provide separate Jest configurations for unit (regular) tests and integration tests, with clear npm scripts to run each independently.

---

## Context

### Background
The repo currently uses a single Jest config embedded in `package.json` that runs both unit and integration suites together.

### Current State
- Jest config is in `scripts/notion/package.json` with roots pointing to `tests/` and `integ/`.
- Integration tests require `.env.test` and access to the test Notion workspace.

### Constraints
- CommonJS Node project using Jest.
- Keep existing test organization under `tests/` and `integ/`.

---

## Technical Approach

### Architecture/Design
- Create two Jest config files in `scripts/notion/`:
  - `jest.unit.config.js` for `tests/`.
  - `jest.integ.config.js` for `integ/`.
- Update `package.json` scripts to expose `test:unit` and `test:integ`, and align `test` to unit tests by default.
- Update docs to reflect the new commands.

### Technology Stack
- Jest.

### Integration Points
- `scripts/notion/package.json` scripts.
- `scripts/notion/AGENTS.md` documentation.

### Important Context
- Integration tests should remain opt-in due to external Notion dependencies.

---

## Steps

### Phase 1: Config + Scripts
- [x] Add `jest.unit.config.js` and `jest.integ.config.js`.
- [x] Update `package.json` scripts to run each config separately.
- [x] Remove or override the embedded Jest config to avoid ambiguity.

### Phase 2: Docs
- [x] Update `AGENTS.md` testing commands and notes.

**Dependencies between phases:**
- Docs follow config changes.

---

## Testing

- `npx jest --config jest.unit.config.js`
- `npx jest --config jest.integ.config.js`

---

## Dependencies

### External Services/APIs
- Notion API (integration tests only).

### Libraries/Packages
- Jest (already in repo).

### Access Required
- [ ] `NOTION_TOKEN` and `TEST_DATABASE_ID` in `.env.test` for integration tests.

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| Confusion about default test behavior | Low | Medium | Make `npm test` run unit tests only and document scripts |
| CI expectations | Medium | Low | Provide `test:all` if needed in future |

---

## Questions

### Clarifications Required
- [x] Default `npm test` should run unit tests only.

---

## Success Criteria

- [x] Separate Jest configs exist for unit and integration suites.
- [x] `npm run test:unit` and `npm run test:integ` run independently.
- [x] Docs reflect updated test commands.

---

## Notes

- None.
