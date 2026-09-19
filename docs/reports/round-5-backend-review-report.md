# Round 5 Senior Backend Review

Date: 2026-09-19  
Repository: `pet_digit_backend`  
Reviewed commit: `12a76c71b0a028f4b760c5e3029c59613e110f07` (`fix(backend): close round four review findings`)  
Reviewer role: Senior Backend Reviewer & Distributed Systems Architect  
Verdict: **APPROVE**

## 1. Executive summary

Round 4 findings C-1, H-1, H-2, M-1, M-2, and L-1 are resolved at the local Firebase Emulator boundary.

- Concurrent requests with the same `clientId` use a bounded 750 ms replay wait and return the same canonical message when the first request commits.
- Media SHA-256 validation uses streaming rather than full-object buffering.
- Recovery and cleanup jobs use bounded pages, persisted cursors, and bounded concurrency.
- Storage Rules verify membership document existence before reading `active`.

Local emulator review gate is approved. This approval does not authorize production deployment.

## 2. Verification matrix

| Check | Command / scope | Result | Evidence |
|---|---|---|---|
| Lint | `npm run lint` | PASS | ESLint 9; 0 errors, 0 warnings |
| Type check | `npm run typecheck` | PASS | TypeScript 5.7 strict checks passed |
| Build | `npm run build` | PASS | Functions build completed |
| Git formatting | `git diff --check` | PASS | No whitespace errors |
| Unit, Rules, integration | `test/*.test.ts`, `rules.test.cjs` | PASS | 11 test files cover lease races, cursor recovery, streaming validation, storage isolation, and tombstone authorization |

## 3. Finding resolution

### 3.1 C-1 and M-1: concurrent replay and transaction atomicity

Locations: `functions/src/index.ts:180-265`

- New requests enter `processing` with a 60-second lease in one transaction.
- Concurrent requests with the same identity call `waitForRequestResolution` every 50 ms for at most 750 ms.
- Polling occurs outside Firestore transactions.
- Each poll verifies `uid`, `roomId`, and `clientId`.
- A committed predecessor returns the same canonical message.
- An unresolved request after 750 ms fails closed with `failed-precondition`.

### 3.2 H-1: bounded expired-request recovery

Locations: `functions/src/index.ts:317-343`, `functions/src/scheduler.ts:79-88`

- Query filters `state in ['reserved', 'processing', 'failed']`.
- Query filters `leaseUntil <= now`.
- Committed requests are excluded.
- Each page is limited to 100 records.
- Base64URL cursor is persisted in `maintenance/scheduler-recovery`.
- Required collection-group composite index exists in `firestore.indexes.json`.

### 3.3 H-2: streaming SHA-256 and resource limits

Locations: `functions/src/media-stream.ts`, `functions/src/index.ts:375`

- `pipeline(object.createReadStream(), hash)` computes SHA-256 without loading the entire object into memory.
- Memory use remains bounded by stream buffering rather than media size.
- `finalizeMediaMessage` declares `memory: '512MiB'`, `timeoutSeconds: 120`, and `concurrency: 10`.

### 3.4 M-2: bounded finalized-media cleanup

Locations: `functions/src/cleanup.ts:12-26`, `functions/src/index.ts:345-370`

- Object listing is limited to 100 entries per page.
- `runWithConcurrency` limits workers to 8.
- 24-hour grace period remains enforced.
- Individual failures emit structured logs and propagate failure for scheduler retry.

### 3.5 L-1: defensive Storage Rules membership check

Location: `storage.rules:6`

- Rule checks `firestore.exists(...)` before evaluating membership field `active`.

## 4. Production readiness requirements

Local approval leaves these production gates open:

1. Create Firebase/GCP staging project with a non-`demo-*` project ID.
2. Deploy Firestore indexes and wait until collection-group indexes report `READY`.
3. Register App Check providers: Apple DeviceCheck/App Attest and Android Play Integrity.
4. Confirm production does not use `APP_CHECK_MODE=bypass`.
5. Deploy three scheduled functions and verify Scheduler/Pub/Sub service-account permissions.
6. Create Cloud Logging alerts for `finalized_media_delete_failed`, `staging_delete_failed`, and `compensation_failed`.
7. Run `npm audit --omit=dev` when registry access is available and record final dependency sign-off.

## 5. Final decision

**APPROVE** for local emulator/backend gate.

Production deployment remains blocked until deployment checklist, Firebase staging configuration, App Check registration, Scheduler wiring, alerts, and dependency audit review are complete.
