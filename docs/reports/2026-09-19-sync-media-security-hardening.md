# Sync and Media Security Hardening Report

## Scope

Closed reviewer BLOCK findings in local Emulator-only backend. No Flutter
files, production Firebase connection, deploy, credentials, or secrets changed.

## Finding closure

- Critical 1: request IDs use SHA-256(`roomId + NUL + clientId`) with stored
  `uid + roomId + clientId` identity checks, so same-room cross-user clientId
  collision is denied inside one transaction; race/replay tests prove one
  canonical message.
- High 2: Rules and Admin SDK require member document `active == true`.
- High 3: client uploads staging only; Functions validate metadata, copy to a
  server-owned message path, delete staging, and Rules deny finalized writes.
- Medium 4: `createMessage` accepts text only; media requires finalize.
- Medium 5: contract normalizes timestamps to ISO strings, validates schema and
  variants, carries media metadata, and requires deleted tombstones for removed
  deltas.
- App Check: production/default enforcement is true; emulator bypass requires
  explicit emulator host variables.

## Second review closure

- High 1: Option B is enforced. Client thumbnail input and thumbnail staging
  paths are rejected. Future thumbnail output is backend-generated only;
  client Rules expose original staging create only.
- High 2: request leases now use `reserved`, `processing`, `committed`,
  `failed`, and `expired`, with `createdAt`, `updatedAt`, and `leaseUntil`.
  Expired recovery, failed retry, compensation delete, and orphan selection
  helpers have emulator/unit coverage.
- Medium 3: checksum requires `sha256:<64 lowercase hex>` and backend computes
  digest from Storage bytes. Missing provider/backend digest fails closed.
- Medium 4: App Check bypass requires explicit emulator mode, bypass mode,
  demo project, all three loopback emulator hosts, and non-production runtime.
- Medium 5: sync ownership is explicit: Flutter owns listener/delta/store/cursor
  merge; backend owns writes, tombstones, schema, Rules, indexes, fixtures,
  and query contract.

## Audit evidence

Latest retry: `2026-09-19T07:49:25Z` UTC. npm registry DNS remained unavailable
(`getaddrinfo ENOTFOUND registry.npmjs.org`); prior audit findings remain the
last valid evidence. No force upgrade and no audit-clear claim.

## Third review closure

- Scheduled Functions are wired with `onSchedule`: request recovery every 5
  minutes, staging cleanup hourly, and finalized orphan cleanup hourly. Config
  supports schedule/TTL overrides; no staging/production default-off switch.
- Recovery is lease-based and idempotent. Staging cleanup validates exact path
  identity, protects active/committed requests, logs delete failures, and throws
  for retry. Finalized cleanup requires no message/request reference plus a
  24-hour grace period.
- Thumbnail contract is Option B: clients cannot upload or submit thumbnail
  paths. Future thumbnail generation is trusted backend-only.
- Filename is required and must match Storage custom metadata. Sender-only
  tombstone authorization is enforced; active membership alone cannot delete
  another sender's message.

## Remaining work

No local-review BLOCK remains. Production deployment checklist still requires a
real Firebase project, Scheduler/Pub/Sub deployment, App Check registration,
log alerts, and staging synthetic verification. Media transcoding, CDN, Redis,
FCM, and thumbnail generation remain explicitly out of scope.

## Round 4 review response

- C-1: active idempotency claims now use 50ms bounded replay polling for 750ms;
  committed returns canonical response, failed/expired reclaims, timeout fails
  closed. Reservation and processing claim are one Firestore transaction.
- H-1: recovery uses state allowlist, `leaseUntil <= now`, composite index,
  100-record limit, ordered document cursor, sequential updates, and committed
  protection.
- H-2: Storage checksum uses `createReadStream()` + `pipeline()` + SHA-256;
  stream errors propagate. Finalize runtime is 512 MiB, 120s, concurrency 10.
- M-1: new requests enter processing atomically with reservation identity and
  lease; separate reserved-to-processing transaction removed.
- M-2: finalized listing is capped at 100; reference/metadata/delete work uses
  concurrency 8, per-object failure logging, retryable invocation failure, and
  grace protection.
- L-1: Storage Rules now require `firestore.exists()` before reading active
  membership; missing, inactive, and active member cases are tested.
