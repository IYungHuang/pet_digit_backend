# Storage Rules contract

Client write scope is one exact path:
`rooms/{roomId}/staging/{uid}/{clientId}/original`.

Rules require authenticated UID = path UID, active room membership, allowlisted
MIME, size <= 50 MiB, and create-only semantics (`resource == null`). Updates,
deletes, traversal-like paths, thumbnail staging paths, and finalized media
writes are denied. Finalized media is trusted backend-owned output.

Functions repeat path, membership, MIME, size, filename, and backend-computed
checksum validation before copying original bytes to
`rooms/{roomId}/media/{messageId}/original`. Rules and Functions intentionally
share active membership (`member.active == true`) and original-only thumbnail
policy.
