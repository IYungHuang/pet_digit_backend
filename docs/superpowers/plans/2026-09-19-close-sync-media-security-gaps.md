# Close Sync and Media Security Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close reviewer BLOCK findings for tenant-scoped idempotency, active membership, immutable finalized media, strict message kinds, contract mapping, and App Check while keeping all verification emulator-only.

**Architecture:** Functions remain the only canonical message writer. Idempotency requests use a deterministic hash of `uid + roomId + clientId`, and every stored request is identity-checked before replay. Media uploads land in owner-only staging; Functions validate metadata, copy to a server-generated finalized message path, delete staging, then publish canonical media metadata. Rules and Functions use `member.active == true`.

**Tech Stack:** Firebase Functions 2nd gen, Firebase Admin SDK, Firestore, Cloud Storage, Auth/Firestore/Storage emulators, TypeScript, Vitest, Rules Unit Testing.

**Spec:** `docs/specs/2026-09-19-firebase-chat-backend-spec.md`, `docs/contracts/chat-sync-v1.md`

## Global Constraints

- Emulator-only; no `firebase deploy`, project ID, production connection, or secrets.
- Client cannot write canonical messages or finalized media.
- `uid + roomId + clientId` is idempotency identity.
- Active membership requires member document exists and `active == true`.
- `createMessage` accepts `kind == text` only; media uses `finalizeMediaMessage`.
- Do not use `npm audit fix --force` or major dependency upgrades.
- Every behavior change follows red test → focused green test → full verification.

### Task 1: Add failing regression tests

**Files:**
- Modify: `functions/test/contracts.test.ts`
- Modify: `functions/test/emulator.integration.test.ts`
- Modify: `functions/test/storage.integration.test.ts`
- Modify: `functions/test/rules.test.cjs`
- Modify: `functions/test/message-contract.test.ts`
- Create: `functions/test/app-check.test.ts`

- [ ] Add tests for cross-user and cross-room request isolation, duplicate races, inactive membership, text-only create, finalized media paths, staging overwrite denial, metadata/checksum validation, ISO timestamps, media fields, tombstones, additive fields, invalid schema, and production App Check enforcement.
- [ ] Run focused tests and record expected failures caused by current implementation.

### Task 2: Harden Functions authorization and idempotency

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/src/fixtures.ts`

- [ ] Require active membership in Admin SDK dependency.
- [ ] Derive request document identity from SHA-256(`uid\0roomId\0clientId`); verify stored identity on every replay.
- [ ] Make transaction winner authoritative under concurrent duplicate requests; return one canonical response.
- [ ] Restrict `createMessage` to text and reject media fields/kinds.
- [ ] Preserve canonical response on idempotent retry without leaking other identities.

### Task 3: Implement server-owned media finalization

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `storage.rules`
- Modify: `functions/test/storage.integration.test.ts`

- [ ] Accept staging path `rooms/{roomId}/staging/{uid}/{clientId}/original` only.
- [ ] Validate owner, active membership, MIME, size, fileName, duration, and checksum metadata.
- [ ] Copy to `rooms/{roomId}/media/{messageId}/original`, optionally copy thumbnail to `.../thumbnail`, delete staging, and store only finalized paths.
- [ ] Reserve/replay media requests safely during retry/race.
- [ ] Allow staging create only when object does not exist; deny staging overwrite and all client finalized mutations.

### Task 4: Normalize and test message contract

**Files:**
- Modify: `functions/src/contracts.ts`
- Modify: `functions/test/message-contract.test.ts`
- Modify: `docs/contracts/chat-sync-v1.md`
- Modify: `docs/specs/2026-09-19-firebase-chat-backend-spec.md`

- [ ] Convert Firestore Timestamp/Date values to ISO strings.
- [ ] Validate schema version, required identity fields, text/media variants, and unknown additive fields.
- [ ] Define removed tombstone payload and finalized media metadata including fileName, durationMs, checksum, and thumbnailStoragePath.

### Task 5: Add App Check seam and documentation

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/test/app-check.test.ts`
- Modify: `README.md`
- Create/modify: `docs/reports/2026-09-19-sync-media-security-hardening.md`

- [ ] Enforce App Check by default outside emulator; emulator uses explicit local-only bypass based on emulator host variables.
- [ ] Test production configuration cannot default to bypass.
- [ ] Document future project registration/enforcement and orphan staging cleanup blocker.

### Task 6: Verify, audit, commit, push

- [ ] Run `npm audit` only with registry available; classify unresolved findings without force upgrades.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:rules`, `npm run test:integration`, `npm run verify`, and `git diff --check`.
- [ ] Confirm backend-only clean tree, commit `fix(backend): close sync and media security gaps`, push `origin/main`, and report exact evidence plus blockers.
