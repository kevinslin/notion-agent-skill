# Notion API vendor notes

Notion API enables integrations to read and write Notion pages, databases, and users.
Use this doc to align auth, request conventions, limits, and error handling for integrations.

## Access and auth

- Create an integration in the integration settings page and obtain its token.
- Use an internal integration token for single-workspace access.
- Share each page or database with the integration before accessing it.
- Use OAuth 2.0 for public integrations that can be used in any workspace.

## Request basics

- Base URL: `https://api.notion.com`
- Require HTTPS for all API requests.
- Use JSON request/response bodies with RESTful HTTP methods.
- Send `Authorization: Bearer <token>` on each request.
- Send `Content-Type: application/json` when making raw HTTP requests.
- Send `Notion-Version: <YYYY-MM-DD>` on each request.
- Use UUIDs for object IDs (dashes are optional in requests).
- Use snake_case for property names.
- Use ISO 8601 strings for date/time values.
- Avoid empty strings; use `null` to clear string values.

## Pagination

- Responses include `results`, `has_more`, and `next_cursor`.
- Requests accept `start_cursor` and `page_size` (max 100).

## Rate limits and size limits

- Average rate limit: 3 requests per second per integration.
- Handle `rate_limited` responses (HTTP 429) and respect `Retry-After`.
- Payload limits include 500 KB and 1000 block elements per request.

## Errors

- Errors include a `code` and `message` in the response body.
- Common codes: `missing_version`, `unauthorized`, `restricted_resource`, `object_not_found`, `rate_limited`.

## SDK

- Notion provides an official JavaScript SDK (`@notionhq/client`).

## References

- Notion API reference (intro): https://developers.notion.com/reference/intro
- Authorization: https://developers.notion.com/docs/authorization
- Versioning: https://developers.notion.com/reference/versioning
- Request limits: https://developers.notion.com/reference/request-limits
- Status codes: https://developers.notion.com/reference/status-codes
