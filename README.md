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
- `finalizeMediaMessage`: Auth, membership, staging path, MIME, size, and
  Storage metadata/checksum validation; server copy to immutable
  `rooms/{roomId}/media/{messageId}/...` before canonical message creation.

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
reset is limited to the emulator room. Orphan upload cleanup remains a future
TTL job and is documented in `docs/contracts/message-delta-v1.md`.

No Redis, CDN, transcoding, FCM, Flutter Firebase SDK, or production Firebase
connection is part of this scaffold. Deployment remains unavailable until a
real Firebase project ID, credentials, and separate deployment review exist.

Membership authorization requires a member document with `active: true` in
both Rules and Functions. Setting `active: false` is the sole revocation
semantic; member deletion is not mixed into authorization logic.

App Check is enforced by default. Only local emulator host variables activate
the explicit local-only bypass. After a Firebase project exists, register each
app with App Check, configure provider credentials, and deploy Functions with
enforcement enabled; never copy emulator bypass variables into staging or
production. Staging uploads have no automatic TTL cleanup job yet; orphan
cleanup remains a documented blocker.

## Required reading

- [Backend specification](docs/specs/2026-09-19-firebase-chat-backend-spec.md)
- [Chat sync contract v1](docs/contracts/chat-sync-v1.md)
- [Agent guide](AGENT.md)

## Local development target

Use Firebase Emulator Suite for Auth, Firestore, Storage, and Functions. Do not
connect local tests to production Firebase projects.
