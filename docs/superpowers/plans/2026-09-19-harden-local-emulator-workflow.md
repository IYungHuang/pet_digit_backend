# Harden Local Emulator Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Firebase Emulator backend 強化為可重複啟動、可 seed、可驗證 Auth/Rules/Functions/Storage/contract 的 local-only workflow。

**Architecture:** Root scripts delegate to `functions` scripts and Firebase CLI. Emulator tests use a shared local fixture seeded through Admin SDK; Rules tests use Rules Unit Testing SDK. Message API exposes transport-neutral delta and pagination contract helpers without leaking Firestore `DocumentChange`.

**Tech Stack:** Node.js 20、TypeScript、Firebase Functions v2、Firebase Admin SDK、Firebase Emulator Suite、Vitest、Firebase Rules Unit Testing SDK。

**Spec:** `docs/specs/2026-09-19-firebase-chat-backend-spec.md` and `docs/contracts/chat-sync-v1.md`

## Global Constraints

- 不執行 `firebase deploy`。
- 不連真實 Firebase project；只使用 `demo-pet-digit` emulator project。
- 不提交 secrets、service-account JSON、Redis、CDN、FCM、media transcoding。
- 不使用 `npm audit fix --force`。
- media size 上限維持 `52,428,800` bytes。

### Task 1: Audit baseline and failing behavior tests

**Files:**
- Create: `docs/audits/2026-09-19-npm-audit.md`
- Create: `functions/test/auth-rules.test.cjs`
- Create: `functions/test/message-contract.test.ts`
- Create: `functions/test/fixtures.test.ts`
- Modify: `functions/test/emulator.integration.test.ts`

- [ ] Run `npm audit --json` inside `functions/`; record production/dev findings and remediation limits.
- [ ] Write failing tests for unauthenticated/member Rules, forged sender/room fields, delta envelope, cursor response, and fixture shape.
- [ ] Run focused tests; confirm expected red failures before implementation.

### Task 2: Domain contract and fixture implementation

**Files:**
- Create: `functions/src/contracts.ts`
- Create: `functions/src/fixtures.ts`
- Modify: `functions/src/index.ts`
- Modify: tests from Task 1

- [ ] Implement `MessageDelta`, `MessageDeltaType`, `toMessageDelta`, and `paginateMessages` minimal APIs.
- [ ] Implement emulator-only fixture seed for users, room, members, text, image metadata, and video metadata.
- [ ] Reject client-owned `senderId`, `roomId`, `state`, `createdAt`, and `updatedAt` fields in create input.
- [ ] Run focused tests; confirm green.

### Task 3: Emulator scripts and integration coverage

**Files:**
- Create: `functions/scripts/emulator-run.mjs`
- Modify: `functions/package.json`
- Modify: `firebase.json`
- Modify: `functions/test/emulator.integration.test.ts`
- Create: `functions/test/storage.integration.test.ts`

- [ ] Add `emulator`, `test:integration`, `test:rules`, and ordered `verify` scripts.
- [ ] Seed fixture before integration tests and verify UID, idempotency, immutable server fields, bounded query, pagination cursor, and finalize metadata.
- [ ] Add Storage staging and orphan cleanup contract tests; leave cleanup implementation out of scope with explicit documentation.
- [ ] Run emulator-backed tests and confirm green.

### Task 4: Rules hardening and documentation

**Files:**
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Modify: `functions/test/rules.test.cjs`
- Modify: `README.md`
- Create: `docs/contracts/message-delta-v1.md`

- [ ] Add explicit unauthenticated/non-member denial assertions and server-owned field rules coverage.
- [ ] Document local-only seed, emulator commands, ports, verify ordering, deploy prerequisite, audit findings, and orphan cleanup TODO.
- [ ] Run full `npm run verify` and `git diff --check`.

### Task 5: Commit and push

**Files:**
- All changed backend files only.

- [ ] Inspect `git status` and ensure no secrets/generated output.
- [ ] Commit `chore(backend): harden local emulator workflow`.
- [ ] Rerun full verification after commit.
- [ ] Push `origin/main` and confirm clean tree.
