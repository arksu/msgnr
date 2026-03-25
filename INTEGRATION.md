# Integration API

This document describes how developers should use the static-token integration endpoints exposed by the backend.

## Overview

Integration endpoints live under `/api/integrations/*` and are intended for `bot` users only.

- Authentication uses a static Bearer token.
- Tokens are stored server-side as SHA-256 hashes in the `integration_token` table.
- Bot users cannot use normal interactive auth flows (`/api/login`, refresh-token rotation, or WS auth).
- Document access still goes through the normal document service permission checks.

## Provision A Bot User

Provisioning is currently done through the admin UI.

1. Create or edit a user and set `role = bot`.
2. Open the user in the admin edit dialog.
3. Enter an `Integration Token` value and save.

Behavior:

- Leaving the token field blank keeps the current active token unchanged.
- Saving a new token revokes the previous active token for that bot and stores the new token hash.
- Changing the user role away from `bot` revokes active integration tokens.
- Only one active integration token is allowed per user.
- Token values must be unique across all users.

Store the raw token in your own secret manager. The application stores only the hash and cannot show the original value later.

## Authentication

Send the token in the `Authorization` header:

```http
Authorization: Bearer <your-static-token>
```

Common auth failures:

- `401 {"error":"missing token"}` when the header is absent or malformed.
- `401 {"error":"invalid token"}` when the token is unknown, revoked, attached to a blocked user, or attached to a non-`bot` user.

## Endpoints

### Get Task

`GET /api/integrations/tasks/{public_id}`

Example:

```bash
curl \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  http://localhost:8080/api/integrations/tasks/INT-123
```

Response:

```json
{
  "title": "Integration task",
  "description": "Task description",
  "fields": [
    {
      "id": "0f9a3d8f-0c1b-4b8d-a1d4-cbeff4ed8cb0",
      "code": "summary",
      "name": "Summary",
      "type": "text",
      "required": true,
      "value_text": "Field value",
      "value_number": null,
      "value_user_id": null,
      "value_date": null,
      "value_datetime": null,
      "value_json": null,
      "enum_dictionary_id": null,
      "enum_version": null
    }
  ]
}
```

Notes:

- `public_id` is the task public ID such as `INT-123`, not the internal UUID.
- The response merges template field metadata with the task's current field values.
- `value_json` is returned as raw JSON when present.
- Current implementation does not enforce teamspace membership for task reads. Any valid active bot token can fetch a task if it knows the task public ID.

Common responses:

- `200` on success
- `404 {"error":"task not found"}`
- `400 {"error":"invalid task id"}` for an empty or malformed path segment

### Create Document

`POST /api/integrations/documents`

Request body:

```json
{
  "title": "Spec",
  "description": "Document body",
  "parent_id": null,
  "teamspace_id": "6da26430-7321-4caf-b426-e6af0d7e890c"
}
```

Example:

```bash
curl \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Spec","description":"Document body","parent_id":null,"teamspace_id":"6da26430-7321-4caf-b426-e6af0d7e890c"}' \
  http://localhost:8080/api/integrations/documents
```

Response:

```json
{
  "id": "2bc9d1f4-1361-49fa-81d8-38801d758a8c",
  "parent_id": null,
  "title": "Spec",
  "description": "Document body"
}
```

Rules:

- `teamspace_id` is required.
- `parent_id` is optional and may be `null`.
- `description` is mapped to the document's internal `content_markdown` field.
- The bot user must be a member of the target teamspace.
- If `parent_id` is provided, the parent document must belong to the same teamspace.

Common responses:

- `201` on success
- `400` for invalid JSON, invalid IDs, or parent/teamspace mismatch
- `403` when the bot is not allowed to create documents in that teamspace

### Get Document

`GET /api/integrations/documents/{id}`

Example:

```bash
curl \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  http://localhost:8080/api/integrations/documents/2bc9d1f4-1361-49fa-81d8-38801d758a8c
```

Response:

```json
{
  "id": "2bc9d1f4-1361-49fa-81d8-38801d758a8c",
  "parent_id": null,
  "title": "Spec",
  "description": "Document body"
}
```

Common responses:

- `200` on success
- `400 {"error":"invalid document id"}`
- `403` when the bot is not a member of the document teamspace
- `404` when the document does not exist

## Error Format

Errors are returned as JSON:

```json
{
  "error": "message"
}
```

## DTO Reference

### `integrationTaskResponseDTO`

```json
{
  "title": "string",
  "description": "string|null",
  "fields": [
    {
      "id": "uuid",
      "code": "string",
      "name": "string",
      "type": "string",
      "required": true,
      "value_text": "string|null",
      "value_number": "string|null",
      "value_user_id": "uuid|null",
      "value_date": "YYYY-MM-DD|null",
      "value_datetime": "RFC3339 timestamp|null",
      "value_json": {},
      "enum_dictionary_id": "uuid|null",
      "enum_version": 1
    }
  ]
}
```

### `integrationDocumentResponseDTO`

```json
{
  "id": "uuid",
  "parent_id": "uuid|null",
  "title": "string",
  "description": "string|null"
}
```

## Current Limitations

- There is no public token-management API yet. Tokens are provisioned out of band through admin user editing.
- Task reads are public-ID based and are not actor-scoped by teamspace membership in the current implementation.
