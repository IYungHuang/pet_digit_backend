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

## Remaining blocker

Orphan staging cleanup TTL job is not implemented. Media transcoding and
thumbnail generation remain out of scope; optional thumbnail copy is supported,
but no thumbnail is synthesized.
