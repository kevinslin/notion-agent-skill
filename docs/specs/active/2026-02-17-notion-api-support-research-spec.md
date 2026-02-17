# Research Spec: Notion API Core Features and Current Support

**Date:** 2026-02-17
**Status:** Complete
**Scope:** Current support in the Notion API reference, with emphasis on core capabilities and practical constraints for integration development.

---

## Executive Summary

As of **February 17, 2026**, the latest stable Notion API version remains **`2025-09-03`**. This version split the old database model into two layers: **databases** (containers) and **data sources** (tables/schemas), and this split is now the central model for current integrations.

Core features currently supported include OAuth token lifecycle APIs, page/block CRUD flows, database/data source management, comments, file upload lifecycle APIs, search, users, and webhooks. The latest changelog entry on **January 15, 2026** adds/expands support for moving pages and template-driven page creation/update workflows.

The API is broad but not fully symmetric. Several operations are intentionally limited (search completeness, linked data retrieval, comment thread creation, view management, and certain property updates), and legacy database endpoints remain available only for older API versions.

---

## Research Questions

1. What are the Notion API’s core feature domains today?
2. What is currently supported for each domain in the latest API model?
3. Which limitations/deprecations materially affect integration design?

---

## Context Triage Gate (Temporal/State Check)

| Value | Source of truth | Representation | Initialization point | Snapshot/capture point | First consumer | Ordering valid? |
| --- | --- | --- | --- | --- | --- | --- |
| API version | `Notion-Version` header docs | date string (e.g. `2025-09-03`) | per request construction | HTTP request headers | endpoint routing/schema behavior | yes |
| Resource parent identity | page/database/data source endpoint docs | `page_id`, `database_id`, `data_source_id` | request body/path construction | request payload serialization | create/move/query/update APIs | yes |
| Capability grants | Integration capabilities config | content/comment/user permissions | integration setup time | auth+capability check before endpoint execution | endpoint authorization layer | yes |
| Data model boundary | versioning + upgrade guide | database container vs data source table | API version selection | when request is validated against version | data endpoints and schema operations | yes |
| Webhook schema version | webhook docs + versioning changes | event type names (`data_source.*` vs `database.*`) | webhook subscription + API version context | event emission | webhook receiver/parsers | yes |
| Pagination cursor | pagination docs | opaque `next_cursor` | list/query response generation | response serialization | subsequent paginated requests | yes |

No critical ordering contradiction was found in the documented model. The primary risk is mixing old database-style assumptions with the new data source model.

---

## Core Features (What Is Supported)

| Domain | Currently supported capabilities | Key endpoints/docs |
| --- | --- | --- |
| Authentication | Public integration OAuth token lifecycle (create, introspect, revoke, refresh); bearer token auth for API calls | `/reference/create-a-token`, `/reference/introspect-token`, `/reference/revoke-token`, `/reference/refresh-a-token` |
| Capability model | Fine-grained content/comment/user capability gates on endpoints | `/reference/capabilities` |
| Pages | Create/retrieve/update pages, move pages, page property item retrieval, archive/trash semantics | `/reference/post-page`, `/reference/retrieve-a-page`, `/reference/patch-page`, `/reference/move-page`, `/reference/retrieve-a-page-property`, `/reference/archive-a-page` |
| Blocks/content | Retrieve/append/update/delete blocks and block children, with nested-content retrieval patterns | `/reference/retrieve-a-block`, `/reference/get-block-children`, `/reference/patch-block-children`, `/reference/update-a-block`, `/reference/delete-a-block` |
| Databases (new model) | Create/retrieve/update database containers and list child data sources | `/reference/database-create`, `/reference/database-retrieve`, `/reference/database-update` |
| Data sources | Create/retrieve/update/query data sources; list templates; schema updates via data source properties | `/reference/create-a-data-source`, `/reference/retrieve-a-data-source`, `/reference/update-a-data-source`, `/reference/query-a-data-source`, `/reference/list-data-source-templates`, `/reference/update-data-source-properties` |
| Comments | Create/list/retrieve comments with explicit comment capabilities | `/reference/create-a-comment`, `/reference/list-comments`, `/reference/retrieve-comment` |
| Files/media | File upload lifecycle: create/send/complete/retrieve/list + attach uploaded files to objects | `/reference/create-a-file-upload`, `/reference/send-a-file-upload`, `/reference/complete-a-file-upload`, `/reference/retrieve-a-file-upload`, `/reference/list-file-uploads`, `/reference/file-upload` |
| Search | Cross-shared-content search for pages/data sources with pagination/filtering/sorting | `/reference/post-search`, `/reference/search-optimizations-and-limitations` |
| Users | List users, retrieve user, retrieve bot self | `/reference/get-users`, `/reference/get-user`, `/reference/get-self` |
| Webhooks | Subscription-based event delivery with signature validation guidance and event-type support | `/reference/webhooks`, `/reference/webhooks-events-delivery` |

---

## Supported With Important Limits

| Area | Limit/constraint | Practical impact |
| --- | --- | --- |
| Page retrieval | `Retrieve a page` does not accurately return property references beyond 25; use page property endpoint for complete values | Any integration reading rich relations/people/mentions must use property-item retrieval for correctness |
| Search | Not optimized for exhaustive enumeration; indexing not immediate | Do not use search as a full crawler or immediate post-share source of truth |
| Comments | Inline comments that start a new discussion thread cannot be created via public API | Automation can add page/block comments and replies, but cannot start inline threads |
| Deletion semantics | Page API supports archive/trash behavior, not permanent delete | Treat delete as reversible lifecycle state unless removed manually in UI policies |
| Data source/query fidelity | Formula/rollup and deep relation cases have documented accuracy limits | High-fidelity analytics should retrieve specific property items and avoid overloading rollups |
| Linked resources | Retrieving linked databases/data sources is not supported via API | Integrations must target and share the original source resources |
| View management | Creating/updating data source views is not currently supported in API | View customization remains app-side; API controls schema/content, not full view UX |
| Users API | `List all users` excludes guests and cannot filter by email/name | Directory sync flows need additional handling for guests and filtering logic outside this endpoint |

---

## Deprecated/Legacy Surface

| Legacy surface | Status | Replacement direction |
| --- | --- | --- |
| Legacy `/v1/databases` schema/query model (`post-database-query`, old retrieve/update pages) | Deprecated as of `2025-09-03` docs (for `2022-06-28` and earlier model) | Use new database container APIs + data source APIs |
| `Get databases` endpoint (`/reference/get-databases`) | Deprecated; only available on `2021-08-16` and earlier | Use Search API |
| Webhook event naming tied to old schema (`database.schema_updated`) | Deprecated in newer model | Use `data_source.schema_updated` in new API version |

---

## Version Snapshot (Current as of 2026-02-17)

- Latest API version: **`2025-09-03`** (`Notion-Version` header required).
- Latest changelog entry (current docs): **January 15, 2026**.
- Notable recent support additions:
  - Move page API.
  - Data source template listing.
  - `template` parameter on create page.
  - `template` + `erase_content` on update page.
- SDK note: `@notionhq/client` v5+ is documented as compatible with `2025-09-03`+ and drops support for older versions.

---

## Recommendations for This Repository

1. Standardize requests on `Notion-Version: 2025-09-03`.
2. Prefer `data_source_id` flows for data operations; avoid old database-query assumptions.
3. Use `Retrieve a page property item` for any potentially high-cardinality references.
4. Treat search as discovery UX, not as complete synchronization.
5. Keep comment automation scoped to page/block/discussion comment paths (not inline-thread creation).
6. If webhooks are adopted, model handlers against `data_source.*` events and signature verification guidance.

---

## References

- API Reference root: https://developers.notion.com/reference/intro
- Versioning: https://developers.notion.com/reference/versioning
- Changes by version: https://developers.notion.com/reference/changes-by-version
- Upgrade guide (`2025-09-03`): https://developers.notion.com/docs/upgrade-guide-2025-09-03
- Changelog: https://developers.notion.com/page/changelog
- Integration capabilities: https://developers.notion.com/reference/capabilities
- Request limits: https://developers.notion.com/reference/request-limits
- Status codes: https://developers.notion.com/reference/status-codes
- Search limitations: https://developers.notion.com/reference/search-optimizations-and-limitations
- Webhooks: https://developers.notion.com/reference/webhooks
- Webhook event types: https://developers.notion.com/reference/webhooks-events-delivery

## Manual Notes 

[keep this for the user to add notes. do not change between edits]

## Changelog
- 2026-02-17: Created initial research spec for Notion API core features and current support status (019c695b-0519-7d80-bac3-fef2d1b0c431)
