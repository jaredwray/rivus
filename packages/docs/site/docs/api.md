---
title: Using the API
navTitle: Using the API
description: Authenticate and call the Rivus REST API.
order: 3
---

# Using the API

The full, always-current endpoint list lives in the [API reference](/api),
generated directly from the API's Zod route schemas.

## Authentication

Register or log in to receive a JWT, then send it as a bearer token.

```bash
# Register
curl -s -X POST http://localhost:4000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"supersecret","name":"Ada"}'

# Use the returned token
curl -s http://localhost:4000/v1/items \
  -H "authorization: Bearer $TOKEN"
```

## Items

Items are owner-scoped — you only ever see your own. List endpoints are paginated
with `?page=` and `?pageSize=` and return a `meta` block:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```
