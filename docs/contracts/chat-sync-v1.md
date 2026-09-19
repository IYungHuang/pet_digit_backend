# Chat Sync Contract v1

Status: baseline contract
Date: 2026-09-19
Owner: `pet_digit_backend`

## 1. Purpose

Define transport-neutral message synchronization between Flutter client and
Firebase backend. Contract uses incremental changes. A client must not reload
an entire room message list when reconnecting.

## 2. Message identity

| Field | Authority | Purpose |
| --- | --- | --- |
| `clientId` | client-generated, immutable | optimistic send, retry, idempotency |
| `messageId` | server-generated, immutable | canonical message identity |
| `roomId` | server-authorized | room scope |
| `senderId` | verified Firebase Auth UID | sender identity |
| `createdAt` | server | ordering and history pagination |
| `updatedAt` | server | modified message version |

`clientId` remains present after acknowledgement. Server deduplicates by
`uid + roomId + clientId` and returns the original canonical message for a
replayed request. Request storage uses a deterministic SHA-256(`roomId + NUL +
clientId`) document ID and stores/verifies full `uid + roomId + clientId`
identity. Same-room cross-user reuse is rejected without returning another
user's message; different rooms never read or reuse another room's request.

## 3. Supported content

```text
text
image/jpeg
image/png
image/gif
image/webp
video/mp4
video/quicktime
```

GIF is an image message. Media upload and message finalization are separate
operations.

## 4. Delta envelope

The backend emits a logical delta. Firebase `DocumentChange` is an adapter
detail and must not leak into domain code.

```json
{
  "schemaVersion": 1,
  "type": "message.added",
  "roomId": "room_123",
  "messageId": "message_abc",
  "clientId": "client_xyz",
  "message": {
    "messageId": "message_abc",
    "clientId": "client_xyz",
    "roomId": "room_123",
    "senderId": "firebase_uid",
    "kind": "text",
    "text": "hello",
    "state": "normal",
    "createdAt": "2026-09-19T04:00:00Z",
    "updatedAt": "2026-09-19T04:00:00Z"
  }
}
```

Allowed types:

```text
message.added
message.modified
message.removed
```

`message.removed` carries `roomId`, `messageId`, `clientId`, and a canonical
message with `state=deleted`; physical document deletion is not required.
Firestore Timestamp values serialize as ISO-8601 strings. Unknown additive
fields remain forward-compatible; unsupported `schemaVersion` is rejected.

## 5. Client merge rules

```text
added    → upsert by messageId, then clientId
modified → replace matching canonical message
removed  → apply tombstone / remove according to client policy
duplicate → no second visible message
```

Client store must retain optimistic pending messages until canonical response
or explicit failure. Reconnect must preserve message store, scroll offset,
drafts, and pending sends.

## 6. History pagination

Live listener is bounded to the active message window. Older history uses a
cursor based on the last visible server document, ordered by `createdAt` plus a
stable document tie-breaker.

```json
{
  "items": [],
  "nextCursor": "opaque-server-cursor",
  "hasMore": true
}
```

Pagination results merge into the client store. They must not replace the full
room projection or reset scroll position.

## 7. Optional reliability extension

`roomSequence` and durable `messageEvents` are not required for v1 MVP. Add
them only after explicit requirements for long-offline gap detection, replay,
or audit ordering. If enabled, server owns sequence assignment and clients
persist `lastAppliedSequence`.

## 8. Compatibility rule

Contract changes require a new version or an additive field. Backend must keep
unknown fields forward-compatible. Client must reject unsupported required
schema versions with a visible sync error and retry policy.
