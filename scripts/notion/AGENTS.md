# CLAUDE.md

This is a CLI for working with notion

## Commands

### Development
```bash
# Run tests (uses .env.test for credentials)
npm test

# Run single test file
npx jest integ/create.test.js

# Run specific test
npx jest integ/create.test.js -t "should create a page with title property"

# Update snapshots
npx jest -u
```

### Running the CLI
```bash
# Via npm bin (requires npm link or local install)
notionv2 create --database-id <id> --properties Name="Test" --bodyFromRawMarkdown "Hello"

# Direct execution
node notion.js create --database-id <id> --properties Name="Test" --bodyFromRawMarkdown "Hello"

# With dotenv
node -r dotenv/config notion.js create --database-id <id> --properties Name="Test"
```

## Architecture

### Modular Command Pattern
The codebase follows a clean separation of concerns:

- **`notion.js`**: CLI entry point and command router using yargs
- **`commands/`**: Individual command modules (currently: `create.js`)
  - Each module exports: `{ command, describe, builder, handler }`
  - Handler contains the command implementation
- **`utils/`**: Shared utility functions
  - `helpers.js`: Core utilities (loadEnv, coerceValueForPropertyType, etc.)
  - `index.js`: Re-exports all utilities
- **`integ/`**: Integration tests that interact with real Notion API

### Key Design Patterns
1. **Command Pattern**: Each command in its own module with consistent yargs interface
2. **Factory Pattern**: Utilities create Notion API objects from simple string inputs
3. **Strategy Pattern**: `loadEnv()` traverses directories to find kevin-garden/.env
4. **Single Responsibility**: Each module has one clear purpose

## Critical Implementation Details

### Property Type Coercion System
The `coerceValueForPropertyType()` function (`utils/helpers.js:64-111`) converts simple string values into Notion's complex property structures. This is essential for CLI usability.

Supported types:
- `title`, `rich_text`: Text content with rich text arrays
- `number`: Validated numeric values
- `date`: ISO8601 date strings (YYYY-MM-DD)
- `select`: Single option objects
- `multi_select`: Comma-separated values → array of option objects
- `status`, `checkbox`, `email`, `phone_number`, `url`: Specialized types
- `relation`: Comma-separated Notion page IDs

**Critical**: Each property type must match the database schema exactly. The create command fetches the database schema first to determine property types.

### Environment Loading Strategy
`loadEnv()` (`utils/helpers.js:11-43`) traverses up from the current directory to find `kevin-garden/.env` or `.env.test`:
- Checks `NODE_ENV` environment variable
  - If `NODE_ENV=test`, loads `kevin-garden/.env.test`
  - Otherwise (including production), loads `kevin-garden/.env`
- Starts at `process.cwd()`
- Walks up until it finds a directory named `kevin-garden`
- Loads the appropriate `.env` file from that directory
- Falls back to standard dotenv if kevin-garden traversal fails

**Critical**: This allows the CLI to work from any subdirectory within the kevin-garden workspace and automatically use the correct environment file for testing vs production.

### Markdown Conversion
`markdownToParagraphBlocks()` (`utils/helpers.js:142-158`) converts markdown to Notion paragraph blocks:
- Splits on newlines
- Creates paragraph blocks with rich text
- Truncates lines at 2000 characters (Notion API limit)

**Limitation**: Only supports paragraph blocks. Headings, lists, and other block types are not parsed from markdown input.

### Testing Strategy

**Unit Tests** (`tests/`):
- Pure logic tests that don't make database calls
- Fast execution, no external dependencies
- Test parsing, validation, and data transformation logic
- Example: `tests/filter.test.js` - tests filter string parsing and AST conversion

**Integration Tests** (`integ/`):
- Interact with real Notion API
- Set `NODE_ENV=test` to automatically load credentials from `kevin-garden/.env.test`
- Require `TEST_DATABASE_ID` environment variable in `.env.test`
- Create actual pages in Notion (not mocked)
- Use snapshots for response validation (exclude dynamic fields like `id`)

**Important**: Integration tests create real data in Notion. Each test page includes a timestamp to avoid conflicts.

## Differences from Original (`../notion`)

### Improvements
1. **Modular structure**: Commands separated into individual files vs. 1130-line monolith
2. **Testability**: Clean module boundaries enable easier testing
3. **Utilities separation**: Shared functions extracted to `utils/`
4. **Consistent interface**: All commands follow yargs conventions

### Simplifications (from v1)
1. **No watchdog timer**: V1 had timeout monitoring system (lines 18-43). Can be added if needed.
2. **No Dendron date inference**: V1 extracted dates from `daily.journal.YYYY.MM.DD.md` filenames. Not yet implemented.
3. **No database discovery**: V1 could find databases by name. V2 requires explicit database IDs.
4. **Simple markdown parsing**: Only paragraph blocks, not headings/lists/etc.
5. **Fewer commands**: V1 had create_page, fetch_page, sync, update. V2 currently has `create`, `list-db`, `sync-meta`, `parse-block`, `status`, and `sync` (fetch/update not yet implemented).

### Future Commands (Not Yet Implemented)
- `fetch`: Query and retrieve pages with filtering
- `update`: Update page metadata

See `llm/plans/2025-12-14-refactor-to-notionv2/plan.md` for the full implementation roadmap.

## File Organization

```
notionv2/
├── notion.js                  # CLI entry point
├── commands/
│   ├── create.js             # Create command implementation
│   ├── list-db.js            # List databases command
│   ├── sync.js               # Sync notes to Notion command
│   └── sync-meta.js          # Sync database metadata command
├── utils/
│   ├── helpers.js            # Core utility functions
│   ├── filter.js             # Filter parsing and conversion
│   └── index.js              # Re-exports
├── tests/
│   └── filter.test.js        # Unit tests (no DB calls)
├── integ/
│   ├── create.test.js        # Integration tests (DB calls)
│   ├── filter.test.js        # Filter integration tests
│   ├── list-db.test.js       # List databases tests
│   ├── sync-meta.test.js     # Sync metadata tests
│   ├── setupTestDatabase.js  # Test database setup script
│   └── __snapshots__/        # Jest snapshots
├── package.json
└── llm/plans/                # Implementation planning docs
```

## Testing Strategy

### Unit Tests
Tests in `tests/` are unit tests that:
1. Test pure logic without external dependencies
2. Don't make any database or API calls
3. Run fast and can be run offline
4. Focus on parsing, validation, and data transformation
5. Example: Filter string parsing and AST conversion

### Integration Tests
Tests in `integ/` are integration tests that:
1. Set `NODE_ENV=test` to automatically load credentials from `kevin-garden/.env.test`
2. Require `TEST_DATABASE_ID` environment variable in `.env.test`
3. Create actual pages in Notion (not mocked)
4. Use snapshots for response validation (exclude dynamic fields like `id`)

**Important**: Integration tests create real data in Notion. Each test page includes a timestamp to avoid conflicts.

### Test Database Requirements

The test database (specified by `TEST_DATABASE_ID` in `.env.test`) must have the following properties for all tests to pass:

| Property Name | Type | Required For | Notes |
|---------------|------|--------------|-------|
| Name | title | All tests | Standard title property (required by Notion) |
| Status | status | Filter tests | Any status options will work |
| Priority | number | Filter tests | Used for numeric filter tests |
| Done | checkbox | Filter tests | Used for boolean filter tests |
| Tags | multi_select | Filter tests | Used for multi-select filter tests |
| Category | select | Filter tests | Used for select filter tests |
| Date | date | Filter tests | Used for date filter tests |
| Description | rich_text | Optional | Used for rich text filter tests |
| dendron_id | rich_text | Sync tests | Required for `notion sync` integration tests |
| last_synced | date | Sync tests | Required for `notion sync` integration tests |

**Setup Helper**: Run `node integ/setupTestDatabase.js` to automatically configure your test database with all required properties.

```bash
# First-time setup
node integ/setupTestDatabase.js

# This will:
# 1. Verify TEST_DATABASE_ID exists and is accessible
# 2. Check which properties already exist
# 3. Add any missing properties
# 4. Provide helpful error messages if database is not found
```

**Creating a Test Database**:
1. Go to notion.so and create a new database (table view)
2. Share it with your integration (Settings & Members > Connections)
3. Copy the database ID from the URL (the part after the last slash, before the `?`)
4. Add `TEST_DATABASE_ID=<database-id>` to `kevin-garden/.env.test`
5. Run `node integ/setupTestDatabase.js` to configure it

**Snapshot testing**: Use `.toMatchSnapshot()` but exclude dynamic fields like IDs and timestamps in production. Current tests snapshot the full response for debugging.

### Running Tests
```bash
# All tests (unit + integration)
npm test

# Only unit tests (fast, no DB calls)
npx jest tests/

# Only integration tests (requires DB access)
npx jest integ/

# Single test file
npx jest integ/create.test.js
npx jest tests/filter.test.js

# Watch mode
npx jest --watch

# Update snapshots
npx jest -u
```

## Common Gotchas

1. **Property names are case-sensitive**: `Name` ≠ `name`. Match the exact casing from the Notion database.

2. **Database IDs must be normalized**: Use UUIDs with dashes. The `normalizeNotionId()` utility handles this.

3. **Title property is required**: Every Notion database has exactly one title property. The create command auto-populates it with empty string if not provided.

4. **Multi-select uses commas**: Pass `--properties Tags="tag1,tag2,tag3"` for multi-select properties.

5. **Environment loading depends on NODE_ENV**:
   - Production (default): loads `kevin-garden/.env`
   - Test (`NODE_ENV=test`): loads `kevin-garden/.env.test`
   - If `loadEnv()` fails, the CLI falls back to standard dotenv in current directory

6. **Notion API errors are nested**: Error details are in `err.body`. The create command handler logs this explicitly.

## Design Documentation

For deeper architectural details, see:
- `../notion/NOTION_CLI_DESIGN.md`: Original CLI design document (property coercion, markdown conversion, query system)
- `../notion/NOTION_CLI_USAGE_GUIDE.md`: Usage patterns and examples from v1
- `llm/plans/2025-12-14-refactor-to-notionv2/plan.md`: Current implementation roadmap
