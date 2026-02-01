# Execution Plan: Refactor Notion CLI to NotionV2

**Date:** 2025-12-14
**Status:** Planning

---

## Goal

Create a clean, modular refactoring of the existing Notion CLI as `notionv2` with improved architecture, separation of concerns, and comprehensive integration testing. The new implementation will focus on four core commands (create, search, fetch, update) with shared utilities.

---

## Context

### Background
The existing Notion CLI (`notion/notion_cli.cjs`) is a monolithic 1130-line file that handles multiple commands with inline implementations. While functional, it has several architectural limitations:
- All code in a single file makes maintenance difficult
- Utilities are mixed with command logic
- Limited test coverage
- Tight coupling between commands

This refactor will create a cleaner, more maintainable implementation with proper separation of concerns and comprehensive testing.

### Current State
The existing implementation (`notion/notion_cli.cjs`) includes:
- Commands: create_page, fetch_page, find_page, update_page, sync, update
- Utilities: property type coercion, markdown conversion, date inference, watchdog timer
- Features: Dendron integration, database discovery, query presets, defensive filtering
- Dependencies: @notionhq/client, yargs, dotenv, short-uuid, js-yaml

The current design document (NOTION_CLI_DESIGN.md) provides comprehensive documentation of:
- Architecture and core components
- Property type coercion system
- Markdown conversion engine
- Query system with presets
- Dendron integration for date inference
- Error handling strategies

### Constraints
- Must maintain compatibility with Notion API (@notionhq/client v2.2.15)
- Must support loading NOTION_TOKEN from environment or .env files
- Must use CommonJS module system (type: "commonjs")
- Integration tests must use .env.test for credentials
- Must preserve existing functionality while improving code organization

---

## Technical Approach

### Architecture/Design
The new implementation will follow a modular command pattern:
- **Entry point**: `notion.js` - CLI router that dispatches to command modules
- **Command modules**: Separate files for each command (create, search, fetch, update)
- **Utilities module**: `utils.js` - Shared utilities (loadEnv, coerceValueForPropertyType)
- **Integration tests**: `integ/` directory with test files for each command

Key architectural improvements over v1:
1. **Separation of concerns**: Each command in its own file
2. **Shared utilities**: Common functions extracted to utils.js
3. **Testability**: Modular design enables easier unit and integration testing
4. **Configuration**: Centralized environment loading with path traversal

### Technology Stack
- **Runtime**: Node.js with CommonJS modules
- **Notion API Client**: @notionhq/client v2.2.15
- **CLI Framework**: yargs v17.7.2
- **Environment Variables**: dotenv v16.4.5
- **Testing**: jest v29.7.0
- **Other dependencies**: js-yaml, short-uuid (copy from v1)

Rationale: Maintain compatibility with existing toolchain while improving structure.

### Integration Points
- **Notion API**: All commands interact with Notion's REST API via @notionhq/client
- **File system**: Reading markdown files, traversing directories for .env
- **Environment**: Loading NOTION_TOKEN from kevin-garden/.env or .env.test
- **Dendron notes**: Future integration for date inference (not in initial scope)

### Design Patterns
1. **Command Pattern**: Each command is a separate module with consistent interface
2. **Factory Pattern**: Utility functions create Notion API objects from simple inputs
3. **Strategy Pattern**: loadEnv traverses directories to find configuration
4. **Single Responsibility**: Each module has one clear purpose

---

## Steps

### Phase 1: Project Setup
- [x] Create notionv2 directory structure
- [ ] Copy package.json from notion/ and update name field to "notionv2"
- [ ] Create basic directory structure:
  - `notion.js` - main entry point
  - `commands/` - command modules directory
  - `utils.js` - utility functions
  - `integ/` - integration tests directory
- [ ] Install dependencies (npm install)

### Phase 2: Utilities Implementation
- [ ] Create `utils.js` with two core functions:
  - `loadEnv()`: Traverse up directories to find kevin-garden/.env, load NOTION_TOKEN
  - `coerceValueForPropertyType(type, raw)`: Copy from notion_cli.cjs lines 208-258
- [ ] Add supporting utilities:
  - `normalizeNotionId()`: Copy from notion_cli.cjs lines 51-65
  - Error handling utilities as needed

### Phase 3: Create Command Implementation
- [ ] Create `commands/create.js` with the create command handler
- [ ] Implement command signature with options:
  - `--database-id <id>`: Required database ID
  - `--properties <key>=<value>`: Repeatable option for properties
  - `--bodyFromRawMarkdown <content>`: Raw markdown content
  - `--bodyFromTextFile <path>`: Path to markdown file
- [ ] Implement core logic:
  - Parse properties and coerce types using database schema
  - Handle body from either raw markdown or file
  - Convert markdown to Notion paragraph blocks
  - Create page via Notion API
- [ ] Add error handling and validation

### Phase 4: Create Command Testing
- [ ] Create `integ/create.test.js`
- [ ] Set up test environment to load .env.test
- [ ] Implement test cases:
  - Create page with properties
  - Create page with raw markdown body
  - Create page with text file body
  - Error handling for missing database-id
  - Error handling for invalid property types
- [ ] Run tests and fix any issues

### Phase 5: Entry Point and CLI Router
- [ ] Create `notion.js` main entry point
- [ ] Set up yargs command router
- [ ] Wire up create command
- [ ] Add help text and usage documentation
- [ ] Update package.json bin field to point to notion.js

### Phase 6: Remaining Commands (Future)
- [ ] Implement `commands/search.js` (placeholder for now)
- [ ] Implement `commands/fetch.js` (placeholder for now)
- [ ] Implement `commands/update.js` (placeholder for now)
- [ ] Add integration tests for each command

**Dependencies between phases:**
- Phase 2 (Utilities) must complete before Phase 3 (Create Command)
- Phase 3 (Create Command) must complete before Phase 4 (Testing)
- Phase 5 (Entry Point) depends on Phase 3 for command wiring
- Phase 6 can proceed after Phase 5, commands can be built incrementally

---

## Dependencies

### External Services/APIs
- **Notion API**: RESTful API for page/database operations - [Documentation](https://developers.notion.com/reference/intro)

### Libraries/Packages
- `@notionhq/client`: v2.2.15 - Official Notion API client
- `dotenv`: v16.4.5 - Environment variable loading
- `yargs`: v17.7.2 - Command-line argument parsing
- `js-yaml`: v4.1.0 - YAML parsing (for frontmatter)
- `short-uuid`: v5.0.0 - UUID generation
- `jest`: v29.7.0 - Testing framework (devDependency)

### Tools/Infrastructure
- **Node.js**: v18+ recommended for modern features
- **npm**: Package management and script running
- **jest**: Integration testing with .env.test environment

### Access Required
- [x] NOTION_TOKEN in .env.test file (already exists)
- [ ] Access to test Notion workspace/database for integration tests
- [ ] Read access to existing notion/ codebase for reference

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| API rate limiting during tests | Medium | Medium | Add delays between test cases, use single test database |
| Breaking changes in property type handling | High | Low | Copy exact implementation from v1, add comprehensive tests |
| Environment loading fails in different directory contexts | Medium | Medium | Implement robust path traversal with error messages |
| Test database pollution | Low | High | Use unique identifiers per test run, or clean up in afterEach |
| Notion API changes | High | Low | Pin @notionhq/client version, monitor for updates |
| Complex markdown parsing | Medium | Low | Start with simple paragraph blocks (same as v1) |

---

## Questions

### Technical Decisions Needed
- [x] Should we use TypeScript or JavaScript? → JavaScript (CommonJS per requirements)
- [x] Should we maintain backward compatibility with v1 CLI flags? → No, this is a new implementation
- [ ] Should integration tests create/cleanup test data or use existing pages? Create new pages
- [ ] Should we implement all four commands now or start with create only? Start only with create

### Clarifications Required
- [ ] What should search command do differently from fetch command? Lets drop search command for now
- [ ] Should we preserve the watchdog timer system from v1? No
- [ ] Should we implement Dendron date inference in the initial create command? No
- [ ] What properties format should --properties accept? (key=value or JSON?) key=value

### Research Tasks
- [ ] Review Notion API docs for any new features since v1 was written 
- [ ] Investigate best practices for CLI argument parsing with yargs
- [ ] Research jest best practices for integration tests with external APIs

---

## Success Criteria

- [ ] notionv2 directory exists with proper structure (notion.js, commands/, utils.js, integ/)
- [ ] package.json copied and updated with correct name and bin entry
- [ ] utils.js implements loadEnv and coerceValueForPropertyType with tests
- [ ] create command implemented with full signature support
- [ ] Integration tests for create command pass with .env.test credentials
- [ ] CLI can be invoked via `npm link` or direct execution
- [ ] Code is modular with clear separation between commands and utilities
- [ ] Error messages are clear and helpful
- [ ] Documentation exists for command usage

---

## Notes

### Simplifications from Original Plan
After reviewing the existing implementation, the following simplifications were made:

1. **Start with create command only**: Rather than implementing all four commands upfront, focus on create command first to establish patterns and ensure architecture works correctly.

2. **Defer Dendron integration**: The date inference from Dendron notes is a nice-to-have feature that can be added later. Initial implementation will focus on explicit property setting.

3. **Simple property parsing**: Use `--properties key=value` format initially rather than complex JSON parsing. This keeps the implementation focused and testable.

4. **Simplified markdown handling**: Like v1, start with paragraph blocks only. Advanced markdown parsing (headings, lists, etc.) can be added incrementally.

5. **No watchdog timer initially**: The watchdog system in v1 (lines 18-43) is a defensive measure for hanging API calls. Can be added if we encounter issues during testing.

### Key Insights from V1 Design Review

From NOTION_CLI_DESIGN.md, the most critical systems to preserve:
- **Property type coercion** (lines 116-157): This is essential for user-friendly CLI input
- **Defensive client-side filtering** (query system): Notion API can be unreliable
- **parseBodyInput utility** (lines 78-92): Handles file vs raw content intelligently
- **Timeout handling**: withTimeout wrapper for all API calls

These should be incorporated into the utils.js or relevant command modules.

### Architecture Decision: Command Module Interface

Each command module in `commands/` should export a consistent interface:
```javascript
module.exports = {
  command: 'create',
  describe: 'Create a new Notion page',
  builder: (yargs) => { /* define options */ },
  handler: async (argv) => { /* implementation */ }
};
```

This follows yargs conventions and makes the main entry point clean.
