# pet_digit_backend

Firebase backend for `pet_digit` chat.

## Scope

- Firebase Authentication
- Cloud Firestore rooms, members, messages, and read cursors
- Cloud Storage image/GIF/video media
- Cloud Functions 2nd gen message and media APIs
- Firestore incremental synchronization
- Emulator and Security Rules tests

## Local emulator scaffold

This repository is local-only by default. It uses demo project ID
`demo-pet-digit`; this is not a production Firebase project and no production
credentials are required.

Install dependencies and start Auth, Firestore, Storage, Functions, and the
Emulator UI:

```bash
cd functions
npm install
npm run build
cd ..
npm run emulator
```

Ports: Auth `9099`, Firestore `8080`, Storage `9199`, Functions `5001`, UI
`4000`. Copy `.env.example` for local emulator variables. Never add real
secrets, project IDs, or service-account JSON to this repository.

## Functions and contracts

- `healthCheck`: emulator-safe HTTP health endpoint.
- `createMessage`: Auth, room membership, text contract, and
  `uid/roomId/clientId` idempotency.
- `finalizeMediaMessage`: Auth, membership, staging path, MIME, size, filename,
  and backend-computed SHA-256 validation; server copy to immutable
  `rooms/{roomId}/media/{messageId}/original` before canonical message creation.
  Client thumbnails are rejected; future thumbnail/transcoding output is
  backend-owned only.
- `removeMessage`: sender-only tombstone writer. Active membership alone does
  not grant delete permission; no admin-delete role exists in current schema.

Client code cannot write `rooms/{roomId}/messages/{messageId}` directly.
Functions are the canonical message writer.

## Tests

From repository root:

```bash
npm install --prefix functions
npm run emulator
npm run test:rules
npm run test:integration
npm run verify
```

`npm run verify` runs lint, typecheck, build, unit tests, Rules tests,
integration tests, and `git diff --check` in that order. Rules/integration
commands own their temporary emulator lifecycle. Emulator UI: `http://127.0.0.1:4000`.

Rules tests and integration tests connect only to local emulators. Seed fixtures
contain users, room, member, text, image metadata, and video metadata; fixture
reset is limited to the emulator room. Integration wrappers automatically start
required emulators; direct `vitest` integration runs require emulator hosts.

Sync ownership is explicit: Flutter owns bounded live listener,
`DocumentChange` mapping, MessageStore merge, and cursor UI; backend owns
canonical writes, tombstones, schema, Rules, indexes, fixtures, and cleanup
helpers. No full-snapshot endpoint exists.

No Redis, CDN, transcoding, FCM, Flutter Firebase SDK, or production Firebase
connection is part of this scaffold. Deployment remains unavailable until a
real Firebase project ID, credentials, and separate deployment review exist.

Membership authorization requires a member document with `active: true` in
both Rules and Functions. Setting `active: false` is the sole revocation
semantic; member deletion is not mixed into authorization logic.

App Check is enforced by default. Local bypass requires all of:
`APP_ENV=emulator`, `APP_CHECK_MODE=bypass`, `GCLOUD_PROJECT=demo-*`, and
loopback Auth/Firestore/Storage emulator hosts. Staging/production never bypass.
The repository emulator wrapper sets these local-only variables automatically;
do not copy them into staging or production.
After a Firebase project exists, register each app with App Check and configure
provider credentials; never copy emulator bypass variables into staging or
production.

Request recovery states are `reserved → processing → committed|failed`, with
`expired` used by `recoverExpiredClientRequests`. Leases include
`createdAt/updatedAt/leaseUntil`; active processing returns retryable
`failed-precondition`. Scheduled recovery runs every 5 minutes by default.
Staging cleanup and finalized-media orphan cleanup run hourly by default.
Defaults: request lease 60s, staging TTL 24h, finalized-media grace period
24h. Override with `REQUEST_RECOVERY_SCHEDULE`, `STAGING_CLEANUP_SCHEDULE`,
`FINALIZED_MEDIA_CLEANUP_SCHEDULE`, `REQUEST_LEASE_MS`, `STAGING_TTL_MS`, and
`FINALIZED_MEDIA_GRACE_MS`. Schedules are exported in emulator and are not
disabled in staging/production; production wiring requires Pub/Sub/Scheduler
deployment and log alert review.

Cleanup is scoped to exact `rooms/{roomId}/staging/{uid}/{clientId}/original`
paths and stored request identity. Active or committed requests are protected.
Delete failures emit structured logs and fail the invocation for retry. Final
media is deleted only when no message/request references it and grace period
has elapsed. No cleanup silently swallows failures.

Filename is required metadata and must match Storage custom metadata. Checksum
is required and must be backend-computed `sha256:<64 lowercase hex>`; caller
claims alone are not trusted.

## Required reading

- [Backend specification](docs/specs/2026-09-19-firebase-chat-backend-spec.md)
- [Chat sync contract v1](docs/contracts/chat-sync-v1.md)
- [Agent guide](AGENT.md)

## Local development target

Use Firebase Emulator Suite for Auth, Firestore, Storage, and Functions. Do not
connect local tests to production Firebase projects.
