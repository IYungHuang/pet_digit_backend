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

- High 1: optional thumbnail source is accepted only at the request-scoped
  staging path. Backend verifies object existence, allowlisted MIME, size, and
  backend-computed SHA-256 before copying; finalized message stores only the
  finalized thumbnail path. Client Rules expose original staging create only;
  thumbnail objects are backend-generated/test-fixture inputs.
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

## Remaining blocker

Scheduler production wiring for staging TTL/recovery/orphan cleanup is not
implemented. Local cleanup selection and execution helpers are emulator-tested.
Media transcoding and thumbnail generation remain out of scope; optional
backend-generated thumbnail copy is supported, but no thumbnail is synthesized.
