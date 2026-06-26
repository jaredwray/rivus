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

## FAQs

FAQs are the question-and-answer entries Rivus draws on to answer your customers.
They are account-scoped (shared by every member) and support full CRUD under
`/v1/faqs`. Each FAQ has a `question`, an `answer`, an optional `category`, and a
`status` of `published` (live) or `draft` (staged but not used yet). The list
endpoint is paginated just like Items.

```bash
# Create an FAQ (status defaults to "published", category to "")
curl -s -X POST http://localhost:4000/v1/faqs \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "question": "How much does a service call cost?",
    "answer": "Our standard diagnostic visit is $89, credited toward any same-day repair.",
    "category": "Pricing"
  }'

# List your FAQs (paginated)
curl -s "http://localhost:4000/v1/faqs?page=1&pageSize=20" \
  -H "authorization: Bearer $TOKEN"

# Update one (any subset of fields; e.g. take it offline)
curl -s -X PATCH http://localhost:4000/v1/faqs/<id> \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"status":"draft"}'

# Delete one
curl -s -X DELETE http://localhost:4000/v1/faqs/<id> \
  -H "authorization: Bearer $TOKEN"
```
