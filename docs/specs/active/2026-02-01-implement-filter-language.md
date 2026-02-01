# Execution Plan: Implement Filter Language

**Date:** 2026-02-01
**Status:** Completed

---

## Goal

Implement the filter language described in `scripts/notion/llm/plans/filter-syntax-design.md` so that unit tests pass and the parser/AST conversion produce Notion API-compatible filters without wiring into the CLI yet.

---

## Context

### Background
The repo already has `scripts/notion/utils/filter.js` plus unit/integration tests. The design doc specifies the CLI filter syntax, precedence rules (OR > AND), nesting limits, value quoting, and property/operator mappings. Unit tests currently define expected behavior for parsing and conversion.

### Current State
A tokenizer/parser/AST converter exists but may not fully align with the design doc and unit tests. `parseFilter()` does not currently enforce nesting depth, and error handling/value conversions need to be validated against the spec.

### Constraints
- Stay within existing module boundaries (no CLI integration).
- Focus on unit tests as success criteria.
- Preserve current coding conventions and error messaging patterns.

---

## Technical Approach

### Architecture/Design
- Keep `tokenize()`, `FilterParser`, and AST-to-Notion conversion in `scripts/notion/utils/filter.js`.
- Use recursive descent parsing with explicit precedence (OR before AND) and parentheses handling.
- Validate property types/operators using schema, and normalize values by type.

### Technology Stack
- Node.js, Jest unit tests

### Integration Points
- `parseFilter()` is consumed by tests and integration code; behavior should match the design doc.

### Design Patterns
- Parser + AST transformation pattern (already present)

### Important Context
- Design spec: `scripts/notion/llm/plans/filter-syntax-design.md`
- Unit tests: `scripts/notion/tests/filter.test.js`
- Integration tests: `scripts/notion/integ/filter.test.js` (not required to run for this task)

---

## Steps

### Phase 1: Validate current implementation against spec/tests
- [x] Review filter design doc requirements and unit tests
- [x] Map gaps in tokenization/parsing/AST conversion

### Phase 2: Implement parser + conversion updates
- [x] Fix tokenizer/parse rules for quotes, colons, AND/OR, parentheses
- [x] Ensure operator precedence (OR before AND) matches spec
- [x] Enforce nesting depth in `parseFilter()`
- [x] Align property/operator validation and value conversion with tests

### Phase 3: Verify
- [x] Run unit tests for filter parser
- [x] Fix any remaining failures

**Dependencies between phases:**
- Phase 2 depends on Phase 1 findings
- Phase 3 depends on Phase 2 implementation

---

## Testing

- `npm run test:unit -- --runTestsByPath scripts/notion/tests/filter.test.js`

---

## Dependencies

### External Services/APIs
- None

### Libraries/Packages
- Jest (already in repo)

### Tools/Infrastructure
- Node/npm

### Access Required
- [ ] None

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| Parser precedence or tokenization mismatch | Med | Med | Align with design doc + unit tests; add targeted fixes |
| Incorrect value coercion for special operators | Med | Low | Validate against unit expectations and Notion API rules |
| Nesting depth not enforced | Low | Med | Call `validateNestingDepth()` in parse flow |

---

## Questions

### Technical Decisions Needed
- [x] Enforce nesting depth during `parseFilter()` (yes, to match spec)

### Clarifications Required
- [x] Focus on unit tests only (per user request)

### Research Tasks
- [x] No external research needed

---

## Success Criteria

- [x] Unit tests in `scripts/notion/tests/filter.test.js` pass
- [x] Filter parsing behavior matches `filter-syntax-design.md`
- [x] No CLI wiring changes introduced

---

## Notes

- Will avoid CLI integration as requested.
