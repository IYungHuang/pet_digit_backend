# Message Delta Contract v1

Backend-facing, transport-neutral contract for Flutter adapter integration.

Allowed delta types:

- `message.added`
- `message.modified`
- `message.removed`

Every delta includes `schemaVersion: 1`, `type`, `roomId`, `messageId`,
`clientId`, and `message`. Message identity and sender fields come from the
server. Firestore `DocumentChange` is never exposed by this contract.

Live listeners use bounded queries ordered by `createdAt` and merge deltas into
client state. Pagination returns `{ items, nextCursor, hasMore }`; pagination
results merge into existing state and do not replace the room projection.

Orphan Storage uploads remain outside this scaffold's runtime cleanup. Staging
objects require a future TTL/orphan cleanup job before production deployment.
