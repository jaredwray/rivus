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

Sign up to create a business account (or log in) to receive a JWT, then send it
as a bearer token. The token is scoped to your account and carries your role.

```bash
# Sign up: creates your user, your business account, and an owner membership
curl -s -X POST http://localhost:4000/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{
    "email": "ada@example.com",
    "password": "supersecret123",
    "name": "Ada Lovelace",
    "business": { "businessName": "Lovelace Analytics", "timezone": "Europe/London" }
  }'

# Use the returned token
curl -s http://localhost:4000/v1/auth/me \
  -H "authorization: Bearer $TOKEN"
```

## Accounts & roles

Every user belongs to one **account**, which owns all of its members' data.
Members hold one of three roles — **Owner**, **Manager**, or **Member** — and
Owners/Managers add teammates via tokenized invites. An Owner can invite any role
(including another Owner); a Manager can only invite Members. Billing and account
settings are Owner-only.

```bash
# Owner or Manager invites a teammate (returns an invite token)
curl -s -X POST http://localhost:4000/v1/members/invites \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"sam@example.com","name":"Sam","role":"member"}'

# The invitee accepts and sets a password to join the account
curl -s -X POST http://localhost:4000/v1/auth/accept-invite \
  -H 'content-type: application/json' \
  -d '{"token":"<invite-token>","password":"brandnewpass1"}'
```

## Items

Items are account-scoped — every member of your account shares them. List
endpoints are paginated with `?page=` and `?pageSize=` and return a `meta` block:

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
