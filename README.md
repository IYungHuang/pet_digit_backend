# pet_digit_backend

Firebase backend for `pet_digit` chat.

## Scope

- Firebase Authentication
- Cloud Firestore rooms, members, messages, and read cursors
- Cloud Storage image/GIF/video media
- Cloud Functions 2nd gen message and media APIs
- Firestore incremental synchronization
- Emulator and Security Rules tests

## Current state

Repository baseline only. Firebase implementation starts after contract review.

## Required reading

- [Backend specification](docs/specs/2026-09-19-firebase-chat-backend-spec.md)
- [Chat sync contract v1](docs/contracts/chat-sync-v1.md)
- [Agent guide](AGENT.md)

## Local development target

Use Firebase Emulator Suite for Auth, Firestore, Storage, and Functions. Do not
connect local tests to production Firebase projects.
