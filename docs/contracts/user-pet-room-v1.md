# User, Pet, and Room Lifecycle Contract v1

Status: Draft / Proposed
Date: 2026-09-21
Owner: `pet_digit_backend` & `pet_digit`

See frontend canonical spec at:
`docs/specs/2026-09-21-user-pet-room-lifecycle-spec.md`

## 1. Summary of Collections

- `/users/{uid}`: Owner profile and default pet pointer (`defaultPetId`).
- `/users/{uid}/pets/{petId}`: Owned pets (1:N), stores real photo, species (`dog` | `cat` | `parrot`), breed, personality.
- `/users/{uid}/roomSummaries/{roomId}`: Chat list fan-out view for fast client loading.
- `/searchTags/{searchTagLower}`: Unique handle index for user search.
- `/rooms/{roomId}`: Canonical room metadata.
- `/rooms/{roomId}/members/{uid}`: Membership, with `pets: PetRoomSnapshot[]` reflecting active pets in this room (default 1, expandable to subset/all).

## 2. Callable Functions (v2 onCall)

1. `upsertUserProfile(nickname, avatarUrl, searchTag)`
2. `searchUsers(query, limit?)`
3. `registerPet(name, species, breed, avatarUrl, gender?, birthday?, personality?, setAsDefault?)`
4. `updatePet(petId, updates)`
5. `setDefaultPet(petId)`
6. `createRoom(type: 'direct' | 'group', inviteeUids, name?, avatarUrl?)`
7. `updateRoomPets(roomId, petIds)`
8. `leaveRoom(roomId)`

All room mutations and member pet deployments MUST run through these functions and adhere to transaction isolation.
Client direct writes to `/rooms` and `/searchTags` are rejected.
