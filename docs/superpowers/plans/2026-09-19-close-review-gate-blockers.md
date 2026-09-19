# Close Review Gate Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden local Firebase Emulator backend against untrusted thumbnail sources, stuck media reservations, weak checksum validation, unsafe App Check bypass, and ambiguous sync ownership.

**Architecture:** Functions own canonical writes and media finalization. Client uploads only original staging objects; optional thumbnails must use the request-scoped staging thumbnail path and validated metadata. Client request documents use a lease-based state machine, with recovery and orphan selection helpers. Flutter owns live Firestore listener/delta merge; backend owns schema, tombstones, bounded query/index contract, and fixtures.

**Tech Stack:** Firebase Functions 2nd gen, Admin SDK, Firestore, Cloud Storage, Auth/Firestore/Storage emulators, TypeScript, Vitest, Rules Unit Testing.

**Spec:** `docs/specs/2026-09-19-firebase-chat-backend-spec.md`, `docs/contracts/chat-sync-v1.md`

## Global Constraints

- Emulator-only; no project creation, production connection, deploy, or secrets.
- Rules remain least privilege; no widening to satisfy tests.
- `createMessage` remains text-only; canonical writes remain Functions-only.
- Checksum is `sha256:<64 lowercase hex>` and missing/unverifiable digest fails closed.
- App Check bypass requires explicit emulator mode, bypass flag, demo project, and all emulator hosts loopback.
- Cleanup helpers must never delete active reservations or committed media.
- Every behavior change follows failing test → focused green test → full verify.

### Task 1: Add failing regression tests

**Files:**
- Modify: `functions/test/storage.integration.test.ts`
- Modify: `functions/test/contracts.test.ts`
- Modify: `functions/test/app-check.test.ts`
- Modify: `functions/test/emulator.integration.test.ts`
- Create: `functions/test/recovery.test.ts`
- Create: `functions/test/query-contract.integration.test.ts`

- [ ] Add foreign-room/UID/client thumbnail rejection, valid/missing thumbnail behavior, finalized-path assertions, checksum format/digest failures, reservation recovery/failed retry/compensation/orphan selection, strict App Check matrix, bounded ordering/tie-breaker/tombstone tests.
- [ ] Run focused suites and record expected failures against current implementation.

### Task 2: Harden thumbnail and checksum validation

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/test/storage.integration.test.ts`

- [ ] Validate optional thumbnail path exactly as `rooms/{roomId}/staging/{uid}/{clientId}/thumbnail`.
- [ ] Validate thumbnail existence, allowed MIME, size, and `sha256:<hex>` digest before copy.
- [ ] Validate original digest with provider metadata or an explicit emulator-only digest adapter; production configuration rejects missing digest.
- [ ] Keep canonical message limited to verified finalized paths.

### Task 3: Add lease-based request recovery and cleanup

**Files:**
- Modify: `functions/src/index.ts`
- Create: `functions/src/cleanup.ts`
- Modify: `functions/test/recovery.test.ts`
- Modify: `functions/test/storage.integration.test.ts`

- [ ] Add `reserved`, `processing`, `committed`, `failed`, `expired` state model with `createdAt`, `updatedAt`, and `leaseUntil`.
- [ ] Recover expired reservations, reject active processing as retryable, retry failed state, and preserve cross-user rejection.
- [ ] Compensate finalized copies after Firestore failure; record cleanup state when compensation fails.
- [ ] Export `recoverExpiredClientRequests` and `cleanupOrphanFinalizedMedia` emulator-safe internal functions/helpers.
- [ ] Select only expired/uncommitted requests and unreferenced finalized media; never select active/committed media.

### Task 4: Make App Check fail closed

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/test/app-check.test.ts`
- Modify: `README.md`

- [ ] Require `APP_ENV=emulator`, `APP_CHECK_MODE=bypass`, `GCLOUD_PROJECT`/project ID `demo-*`, and loopback Auth/Firestore/Storage hosts for bypass.
- [ ] Return required enforcement for staging/production, non-loopback, partial emulator, and missing config; expose test seam for valid App Check acceptance.
- [ ] Document local variables and production deployment checklist.

### Task 5: Clarify sync ownership and query contract

**Files:**
- Modify: `docs/contracts/chat-sync-v1.md`
- Modify: `docs/specs/2026-09-19-firebase-chat-backend-spec.md`
- Modify: `firestore.indexes.json`
- Modify: `functions/src/fixtures.ts`
- Create: `functions/src/query-contract.ts`
- Create/modify: `functions/test/query-contract.integration.test.ts`

- [ ] State Flutter owns live listener, `DocumentChange` mapping, store merge, and cursor UI; backend owns canonical writes, tombstones, schema, rules, indexes, and fixtures.
- [ ] Define `createdAt ASC + __name__ ASC` stable ordering, bounded limit, opaque cursor, and tombstone fixture.
- [ ] Test emulator query order, bounded result, pagination cursor shape, and deleted tombstone.

### Task 6: Verify, audit, commit, push

- [ ] Run `npm audit` when registry is available; otherwise update audit evidence with exact timestamp/status without claiming clear.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:rules`, `npm run test:integration`, `npm run verify`, and `git diff --check`.
- [ ] Confirm backend-only clean tree, commit `fix(backend): close review gate blockers`, push `origin/main`, report blockers and review readiness.
