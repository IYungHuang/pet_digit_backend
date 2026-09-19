# Message Delta Contract v1

Backend-facing, transport-neutral contract for Flutter adapter integration.

Allowed delta types:

- `message.added`
- `message.modified`
- `message.removed`

Every delta includes `schemaVersion: 1`, `type`, `roomId`, `messageId`,
`clientId`, and `message`. Message identity and sender fields come from the
server. Firestore `DocumentChange` is never exposed by this contract.

Live listener ownership belongs to Flutter Firebase adapter. Backend supplies
bounded-query-compatible documents ordered by `createdAt ASC` plus document ID
`ASC` tie-breaker, with limit 50 (maximum 100), tombstone state, Rules, and
indexes. Pagination returns `{ items, nextCursor, hasMore }`; pagination
results merge into existing state and do not replace the room projection.

Local backend exposes scheduled expired-request recovery, staging TTL cleanup,
and finalized-media orphan selection/cleanup. Production deployment still
requires Scheduler wiring review and deployment checklist.
