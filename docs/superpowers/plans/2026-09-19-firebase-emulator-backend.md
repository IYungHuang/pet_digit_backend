# Firebase Emulator Backend Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可由 Firebase Emulator Suite 啟動與測試的 TypeScript Functions backend scaffold。

**Architecture:** Functions 2nd gen 使用 Admin SDK 寫入 canonical messages；Auth、Firestore、Storage Rules 管控 client access。message APIs 透過 Auth、membership、payload/path validation 與 `uid/roomId/clientId` transaction idempotency 保護邊界。

**Tech Stack:** Node.js、TypeScript、Firebase Functions v2、Firebase Admin SDK、Firebase CLI Emulator Suite、Vitest、Firebase Rules Unit Testing SDK。

**Spec:** `docs/superpowers/specs/2026-09-19-firebase-emulator-backend-design.md`

## Global Constraints

- 不連 production Firebase，不提交真實 project ID、secret 或 service-account JSON。
- Canonical messages 僅由 Functions/Admin SDK 寫入。
- 不使用 Redis、Cloud CDN、media transcoding 或 Flutter Firebase SDK。
- media size 上限為 `52,428,800` bytes。
- 所有 backend tests 使用 emulator。

### Task 1: Firebase configuration and failing test scaffold

**Files:**
- Create: `firebase.json`, `.firebaserc.example`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts`
- Create: `functions/test/contracts.test.ts`, `functions/test/rules.test.ts`

- [ ] **Step 1: Write failing contract tests** for authenticated create, duplicate `clientId`, and invalid finalize input.
- [ ] **Step 2: Write failing rules tests** for canonical message client write denial and staging path ownership/size checks.
- [ ] **Step 3: Run tests** with `npm test`; confirm failures come from missing functions/rules behavior.
- [ ] **Step 4: Add emulator configuration and TypeScript package scripts** without production credentials.

### Task 2: Minimal Functions implementation

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/test/contracts.test.ts`

- [ ] **Step 1: Implement Auth context and membership interface** reading `rooms/{roomId}/members/{uid}`.
- [ ] **Step 2: Implement `createMessage` validation and transaction** creating `clientRequests/{clientId}` and canonical message.
- [ ] **Step 3: Implement `finalizeMediaMessage` validation** for staging path, MIME, size, and transaction idempotency.
- [ ] **Step 4: Implement `healthCheck`** with emulator-safe response.
- [ ] **Step 5: Run contract tests** and confirm green.

### Task 3: Rules and integration verification

**Files:**
- Modify: `firestore.rules`, `storage.rules`
- Modify: `functions/test/rules.test.ts`
- Create: `functions/test/emulator.integration.test.ts`

- [ ] **Step 1: Add Firestore member read and cursor/profile self-write rules** while retaining canonical message write denial.
- [ ] **Step 2: Add Storage staging write/read rules** for authenticated owner, allowed MIME, and 50 MiB limit.
- [ ] **Step 3: Run Auth/Firestore/Storage/Functions emulator integration tests** and inspect all failures.
- [ ] **Step 4: Fix only behavior covered by failing tests; rerun until green.**

### Task 4: Documentation and final verification

**Files:**
- Modify: `README.md`
- Create: `.env.example`

- [ ] **Step 1: Document emulator startup, test commands, ports, environment variables, and production isolation.**
- [ ] **Step 2: Run lint and typecheck.**
- [ ] **Step 3: Run full emulator test command and `git diff --check`.**
- [ ] **Step 4: Inspect `git status`, commit exact message, rerun verification, and push `origin/main`.**
