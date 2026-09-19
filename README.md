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
firebase emulators:start --project demo-pet-digit
```

Ports: Auth `9099`, Firestore `8080`, Storage `9199`, Functions `5001`, UI
`4000`. Copy `.env.example` for local emulator variables. Never add real
secrets, project IDs, or service-account JSON to this repository.

## Functions and contracts

- `healthCheck`: emulator-safe HTTP health endpoint.
- `createMessage`: Auth, room membership, text contract, and
  `uid/roomId/clientId` idempotency.
- `finalizeMediaMessage`: Auth, membership, staging path, MIME, size, and
  Storage metadata validation before canonical message creation.

Client code cannot write `rooms/{roomId}/messages/{messageId}` directly.
Functions are the canonical message writer.

## Tests

With emulators running in another terminal:

```bash
cd functions
npm test
npm run test:rules
npm run typecheck
npm run build
```

Rules tests and integration tests connect only to local emulators. No Redis,
CDN, transcoding, Flutter Firebase SDK, or production Firebase connection is
part of this scaffold.

## Required reading

- [Backend specification](docs/specs/2026-09-19-firebase-chat-backend-spec.md)
- [Chat sync contract v1](docs/contracts/chat-sync-v1.md)
- [Agent guide](AGENT.md)

## Local development target

Use Firebase Emulator Suite for Auth, Firestore, Storage, and Functions. Do not
connect local tests to production Firebase projects.
