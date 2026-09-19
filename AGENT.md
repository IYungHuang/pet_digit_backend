# Backend Agent Guide

This repository owns Firebase backend infrastructure for `pet_digit`.

Read these documents before implementation:

- `docs/specs/2026-09-19-firebase-chat-backend-spec.md`
- `docs/contracts/chat-sync-v1.md`
- `README.md`

Rules:

- Backend is the authority for authentication, membership, canonical messages, idempotency, and media finalization.
- Client never writes canonical messages or sync events directly.
- Message synchronization is incremental; do not introduce full-room refresh APIs as the live update path.
- Every backend change requires emulator tests and `git diff --check` before commit.
