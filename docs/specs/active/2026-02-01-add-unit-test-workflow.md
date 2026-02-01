# Execution Plan: Add Unit Test Workflow

**Date:** 2026-02-01
**Status:** Completed

---

## Goal

Add a GitHub Actions workflow that runs the non-integration (unit) Jest tests on CI.

---

## Context

### Background
The repo currently runs tests locally via npm scripts, but no CI workflow exists. Integration tests require Notion credentials and should remain opt-in, so CI should only run unit tests.

### Current State
- No `.github/workflows` directory.
- Unit tests live under `scripts/notion/tests` and can be run with `npx jest tests/`.

### Constraints
- Keep CI limited to unit tests; do not run integration tests.
- Node project under `scripts/notion`.

---

## Technical Approach

### Architecture/Design
- Add a workflow in `.github/workflows/unit-tests.yml` that:
  - Triggers on push and pull requests.
  - Sets up Node.js.
  - Installs dependencies in `scripts/notion`.
  - Runs `npx jest tests/`.

### Integration Points
- `scripts/notion/package.json` scripts.
- GitHub Actions runners.

### Important Context
- Integration tests require Notion credentials and should not run in CI.

---

## Steps

### Phase 1: Workflow
- [x] Create `.github/workflows/unit-tests.yml` to run unit tests.
- [x] Ensure workflow runs in `scripts/notion` and uses `npx jest tests/`.

### Phase 2: Documentation
- [x] Update docs if necessary to mention CI behavior.

**Dependencies between phases:**
- None.

---

## Testing

- `npx jest tests/` (locally)

---

## Dependencies

### Tools/Infrastructure
- GitHub Actions runner with Node.js.

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| CI accidentally runs integration tests | Medium | Low | Explicitly run `npx jest tests/` |

---

## Questions

### Clarifications Required
- [x] CI should run unit tests only.

---

## Success Criteria

- [x] Workflow runs on PRs and pushes.
- [x] CI runs unit tests only.

---

## Notes

- Documentation updates were not required beyond this plan.
