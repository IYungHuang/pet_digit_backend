import { randomUUID } from 'node:crypto';
import { getApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

try { getApp(); } catch { initializeApp(); }
import {
  deterministicDmRoomId,
  type PetProfile,
  type PetRoomSnapshot,
  type PetSpecies,
  type RoomType,
  type UserProfile,
  validateAvatarUrl,
  validateNickname,
  validatePetBreed,
  validatePetGender,
  validatePetName,
  validatePetPersonality,
  validatePetSpecies,
  validatePhotoUrls,
  validateSearchTag,
} from './user-pet-room-contracts';

export type AuthenticatedContext = {
  auth: { uid: string } | null;
  data: Record<string, unknown>;
};

function requireCallerUid(context: AuthenticatedContext): string {
  const uid = context.auth?.uid;
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  return uid;
}

function formatIso(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return new Date().toISOString();
}

/**
 * 1. upsertUserProfile
 * Updates or creates user profile, atomically enforcing unique searchTagLower.
 */
export async function upsertUserProfileHandler(
  context: AuthenticatedContext,
): Promise<UserProfile> {
  const uid = requireCallerUid(context);
  const nickname = validateNickname(context.data.nickname);
  const avatarUrl = validateAvatarUrl(context.data.avatarUrl);
  const { original: searchTag, lower: searchTagLower } = validateSearchTag(
    context.data.searchTag,
  );

  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const searchTagRef = db.doc(`searchTags/${searchTagLower}`);

  return await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    const searchTagDoc = await transaction.get(searchTagRef);

    if (searchTagDoc.exists) {
      const existingTagUid = searchTagDoc.data()?.uid;
      if (existingTagUid !== uid) {
        throw new HttpsError(
          'already-exists',
          `Search tag @${searchTag} is already taken`,
        );
      }
    }

    let defaultPetId = '';
    let createdAt = FieldValue.serverTimestamp();

    if (userDoc.exists) {
      const existingData = userDoc.data()!;
      defaultPetId = (existingData.defaultPetId as string) ?? '';
      createdAt = existingData.createdAt ?? FieldValue.serverTimestamp();

      const oldSearchTagLower = existingData.searchTagLower as string | undefined;
      if (oldSearchTagLower && oldSearchTagLower !== searchTagLower) {
        transaction.delete(db.doc(`searchTags/${oldSearchTagLower}`));
      }

      transaction.update(userRef, {
        nickname,
        avatarUrl,
        searchTag,
        searchTagLower,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      transaction.set(userRef, {
        uid,
        nickname,
        avatarUrl,
        searchTag,
        searchTagLower,
        defaultPetId: '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(searchTagRef, {
      searchTag,
      searchTagLower,
      uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      uid,
      nickname,
      avatarUrl,
      searchTag,
      searchTagLower,
      defaultPetId,
      createdAt: formatIso(createdAt),
      updatedAt: new Date().toISOString(),
    };
  });
}

/**
 * 2. searchUsers
 * Looks up users by @tag or by searchTagLower prefix. Excludes caller.
 */
export async function searchUsersHandler(
  context: AuthenticatedContext,
): Promise<Array<{ uid: string; nickname: string; avatarUrl: string; searchTag: string; defaultPetId?: string }>> {
  const callerUid = requireCallerUid(context);
  const rawQuery = String(context.data.query ?? '').trim();
  if (rawQuery.length === 0) return [];

  const rawLimit = Number(context.data.limit ?? 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 30);

  const db = getFirestore();

  if (rawQuery.startsWith('@')) {
    const tag = rawQuery.slice(1).trim().toLowerCase();
    if (tag.length === 0) return [];

    const tagDoc = await db.doc(`searchTags/${tag}`).get();
    if (!tagDoc.exists) return [];

    const targetUid = tagDoc.data()?.uid as string;
    if (targetUid === callerUid) return [];

    const targetUserDoc = await db.doc(`users/${targetUid}`).get();
    if (!targetUserDoc.exists) return [];

    const data = targetUserDoc.data()!;
    return [
      {
        uid: targetUid,
        nickname: data.nickname ?? '',
        avatarUrl: data.avatarUrl ?? '',
        searchTag: data.searchTag ?? tag,
        defaultPetId: data.defaultPetId || undefined,
      },
    ];
  }

  const queryLower = rawQuery.toLowerCase();
  const snapshot = await db
    .collection('users')
    .where('searchTagLower', '>=', queryLower)
    .where('searchTagLower', '<=', queryLower + '\uf8ff')
    .limit(limit + 5)
    .get();

  const results: Array<{ uid: string; nickname: string; avatarUrl: string; searchTag: string; defaultPetId?: string }> = [];
  for (const doc of snapshot.docs) {
    if (doc.id === callerUid) continue;
    const data = doc.data();
    results.push({
      uid: doc.id,
      nickname: data.nickname ?? '',
      avatarUrl: data.avatarUrl ?? '',
      searchTag: data.searchTag ?? '',
      defaultPetId: data.defaultPetId || undefined,
    });
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * 3. registerPet
 * Registers a new pet under /users/{uid}/pets/{petId}.
 * Sets as default if first pet or setAsDefault == true.
 */
export async function registerPetHandler(
  context: AuthenticatedContext,
): Promise<PetProfile & { isDefault: boolean }> {
  const uid = requireCallerUid(context);
  const name = validatePetName(context.data.name);
  const species = validatePetSpecies(context.data.species);
  const breed = validatePetBreed(context.data.breed);
  const avatarUrl = validateAvatarUrl(context.data.avatarUrl);
  const photoUrls = validatePhotoUrls(context.data.photoUrls);
  const gender = validatePetGender(context.data.gender);
  const personality = validatePetPersonality(context.data.personality);
  const birthday = typeof context.data.birthday === 'string' ? context.data.birthday : null;
  const setAsDefault = Boolean(context.data.setAsDefault);

  const petId = randomUUID();
  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const petRef = db.doc(`users/${uid}/pets/${petId}`);

  return await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) {
      throw new HttpsError(
        'failed-precondition',
        'User profile does not exist. Call upsertUserProfile first.',
      );
    }

    const userData = userDoc.data()!;
    const isFirstPet = !userData.defaultPetId || userData.defaultPetId === '';
    const shouldBeDefault = isFirstPet || setAsDefault;

    const petData = {
      petId,
      ownerUid: uid,
      name,
      species,
      breed,
      avatarUrl,
      photoUrls,
      gender,
      personality,
      birthday,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(petRef, petData);

    if (shouldBeDefault) {
      transaction.update(userRef, {
        defaultPetId: petId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      petId,
      ownerUid: uid,
      name,
      species,
      breed,
      avatarUrl,
      photoUrls,
      gender,
      personality,
      birthday,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDefault: shouldBeDefault,
    };
  });
}

/**
 * 4. updatePet
 * Updates pet profile fields. Cannot change petId or ownerUid.
 */
export async function updatePetHandler(
  context: AuthenticatedContext,
): Promise<{ success: true; petId: string }> {
  const uid = requireCallerUid(context);
  const petId = String(context.data.petId ?? '').trim();
  if (!petId) {
    throw new HttpsError('invalid-argument', 'petId is required');
  }

  const updates = (context.data.updates ?? {}) as Record<string, unknown>;
  const sanitizedUpdates: Record<string, unknown> = {};

  if (updates.name !== undefined) sanitizedUpdates.name = validatePetName(updates.name);
  if (updates.species !== undefined) sanitizedUpdates.species = validatePetSpecies(updates.species);
  if (updates.breed !== undefined) sanitizedUpdates.breed = validatePetBreed(updates.breed);
  if (updates.avatarUrl !== undefined) sanitizedUpdates.avatarUrl = validateAvatarUrl(updates.avatarUrl);
  if (updates.photoUrls !== undefined) sanitizedUpdates.photoUrls = validatePhotoUrls(updates.photoUrls);
  if (updates.gender !== undefined) sanitizedUpdates.gender = validatePetGender(updates.gender);
  if (updates.personality !== undefined) sanitizedUpdates.personality = validatePetPersonality(updates.personality);
  if (updates.birthday !== undefined) sanitizedUpdates.birthday = typeof updates.birthday === 'string' ? updates.birthday : null;

  delete sanitizedUpdates.petId;
  delete sanitizedUpdates.ownerUid;
  delete sanitizedUpdates.createdAt;

  if (Object.keys(sanitizedUpdates).length === 0) {
    return { success: true, petId };
  }

  const db = getFirestore();
  const petRef = db.doc(`users/${uid}/pets/${petId}`);

  await db.runTransaction(async (transaction) => {
    const petDoc = await transaction.get(petRef);
    if (!petDoc.exists) {
      throw new HttpsError('not-found', `Pet ${petId} not found`);
    }

    transaction.update(petRef, {
      ...sanitizedUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { success: true, petId };
}

/**
 * 5. setDefaultPet
 * Changes user's defaultPetId.
 */
export async function setDefaultPetHandler(
  context: AuthenticatedContext,
): Promise<{ success: true; defaultPetId: string }> {
  const uid = requireCallerUid(context);
  const petId = String(context.data.petId ?? '').trim();
  if (!petId) {
    throw new HttpsError('invalid-argument', 'petId is required');
  }

  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const petRef = db.doc(`users/${uid}/pets/${petId}`);

  await db.runTransaction(async (transaction) => {
    const petDoc = await transaction.get(petRef);
    if (!petDoc.exists) {
      throw new HttpsError('not-found', `Pet ${petId} not found for this user`);
    }

    transaction.update(userRef, {
      defaultPetId: petId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { success: true, defaultPetId: petId };
}

/**
 * 6. createRoom
 * Creates 1v1 direct room (deterministic ID) or group room (UUID).
 * Injects initial default pet snapshot for each member into /rooms/{roomId}/members/{uid}.
 * Synchronizes /users/{uid}/roomSummaries/{roomId}.
 */
export async function createRoomHandler(
  context: AuthenticatedContext,
): Promise<{ roomId: string; type: RoomType; memberCount: number; existed: boolean }> {
  const callerUid = requireCallerUid(context);
  const type = context.data.type as RoomType;
  if (type !== 'direct' && type !== 'group') {
    throw new HttpsError('invalid-argument', "Room type must be 'direct' or 'group'");
  }

  const rawInvitees = Array.isArray(context.data.inviteeUids)
    ? (context.data.inviteeUids as unknown[])
    : [];
  const inviteeUids = Array.from(
    new Set(
      rawInvitees
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
        .filter((id) => id !== callerUid),
    ),
  );

  let roomId: string;
  let roomName = '';
  const groupAvatarUrl =
    typeof context.data.avatarUrl === 'string' && context.data.avatarUrl.trim().length > 0
      ? context.data.avatarUrl.trim()
      : null;

  if (type === 'direct') {
    if (inviteeUids.length !== 1) {
      throw new HttpsError('invalid-argument', 'Direct message requires exactly one other member');
    }
    roomId = deterministicDmRoomId(callerUid, inviteeUids[0]);
  } else {
    roomName = String(context.data.name ?? '').trim();
    if (roomName.length === 0 || roomName.length > 50) {
      throw new HttpsError('invalid-argument', 'Group room name is required (1-50 characters)');
    }
    roomId = randomUUID();
  }

  const allMemberUids = Array.from(new Set([callerUid, ...inviteeUids]));
  const db = getFirestore();
  const roomRef = db.doc(`rooms/${roomId}`);

  return await db.runTransaction(async (transaction) => {
    const existingRoomDoc = await transaction.get(roomRef);

    // If 1v1 room already exists, ensure active and reactivate summaries
    if (type === 'direct' && existingRoomDoc.exists) {
      for (const mUid of allMemberUids) {
        const memberRef = db.doc(`rooms/${roomId}/members/${mUid}`);
        const summaryRef = db.doc(`users/${mUid}/roomSummaries/${roomId}`);
        transaction.update(memberRef, {
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(summaryRef, {
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { roomId, type: 'direct', memberCount: 2, existed: true };
    }

    // Read user profiles for all members
    const userDocs = await Promise.all(
      allMemberUids.map((mUid) => transaction.get(db.doc(`users/${mUid}`))),
    );

    for (let i = 0; i < allMemberUids.length; i++) {
      if (!userDocs[i].exists) {
        throw new HttpsError('not-found', `User profile not found for uid: ${allMemberUids[i]}`);
      }
    }

    // Read default pets for each member
    const defaultPetSnapshots: Map<string, PetRoomSnapshot | null> = new Map();
    for (let i = 0; i < allMemberUids.length; i++) {
      const mUid = allMemberUids[i];
      const defaultPetId = userDocs[i].data()?.defaultPetId as string | undefined;
      if (defaultPetId) {
        const petDoc = await transaction.get(db.doc(`users/${mUid}/pets/${defaultPetId}`));
        if (petDoc.exists) {
          const p = petDoc.data()!;
          defaultPetSnapshots.set(mUid, {
            petId: defaultPetId,
            name: p.name ?? '',
            species: p.species as PetSpecies,
            breed: p.breed ?? '',
            avatarUrl: p.avatarUrl ?? '',
            personality: p.personality ?? 'playful',
          });
          continue;
        }
      }
      defaultPetSnapshots.set(mUid, null);
    }

    // Set Room Document
    const roomData = {
      roomId,
      type,
      name: type === 'group' ? roomName : '',
      avatarUrl: type === 'group' ? groupAvatarUrl : null,
      createdBy: callerUid,
      memberCount: allMemberUids.length,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(roomRef, roomData);

    // Set members and roomSummaries
    for (let i = 0; i < allMemberUids.length; i++) {
      const mUid = allMemberUids[i];
      const memberRole = type === 'group' && mUid === callerUid ? 'owner' : 'member';
      const petSnapshot = defaultPetSnapshots.get(mUid);
      const memberPets: PetRoomSnapshot[] = petSnapshot ? [petSnapshot] : [];

      const memberRef = db.doc(`rooms/${roomId}/members/${mUid}`);
      transaction.set(memberRef, {
        uid: mUid,
        role: memberRole,
        active: true,
        joinedAt: FieldValue.serverTimestamp(),
        pets: memberPets,
      });

      // Determine summary name and avatar
      let summaryName = roomName;
      let summaryAvatar = groupAvatarUrl;
      if (type === 'direct') {
        const otherUserIndex = i === 0 ? 1 : 0;
        const otherUserData = userDocs[otherUserIndex].data()!;
        summaryName = (otherUserData.nickname as string) || '';
        summaryAvatar = (otherUserData.avatarUrl as string) || null;
      }

      const summaryRef = db.doc(`users/${mUid}/roomSummaries/${roomId}`);
      transaction.set(summaryRef, {
        roomId,
        type,
        name: summaryName,
        avatarUrl: summaryAvatar,
        unreadCount: 0,
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      roomId,
      type,
      memberCount: allMemberUids.length,
      existed: false,
    };
  });
}

/**
 * 7. updateRoomPets
 * Deploys/summons a subset or all of caller's pets into the room.
 * Updates /rooms/{roomId}/members/{uid}.pets snapshot.
 */
export async function updateRoomPetsHandler(
  context: AuthenticatedContext,
): Promise<{ success: true; activePets: PetRoomSnapshot[] }> {
  const uid = requireCallerUid(context);
  const roomId = String(context.data.roomId ?? '').trim();
  if (!roomId) {
    throw new HttpsError('invalid-argument', 'roomId is required');
  }

  const rawPetIds = Array.isArray(context.data.petIds) ? context.data.petIds : [];
  const petIds = Array.from(
    new Set(
      rawPetIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim()),
    ),
  );

  const db = getFirestore();
  const memberRef = db.doc(`rooms/${roomId}/members/${uid}`);

  return await db.runTransaction(async (transaction) => {
    const memberDoc = await transaction.get(memberRef);
    if (!memberDoc.exists || memberDoc.data()?.active !== true) {
      throw new HttpsError(
        'permission-denied',
        'Caller is not an active member of this room',
      );
    }

    const snapshots: PetRoomSnapshot[] = [];
    for (const petId of petIds) {
      const petDoc = await transaction.get(db.doc(`users/${uid}/pets/${petId}`));
      if (!petDoc.exists) {
        throw new HttpsError(
          'not-found',
          `Pet ${petId} not found or not owned by caller`,
        );
      }
      const data = petDoc.data()!;
      snapshots.push({
        petId,
        name: data.name ?? '',
        species: data.species as PetSpecies,
        breed: data.breed ?? '',
        avatarUrl: data.avatarUrl ?? '',
        personality: data.personality ?? 'playful',
      });
    }

    transaction.update(memberRef, {
      pets: snapshots,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, activePets: snapshots };
  });
}

/**
 * 8. leaveRoom
 * Deactivates member in /rooms/{roomId}/members/{uid}, clears deployed pets,
 * deactivates /users/{uid}/roomSummaries/{roomId}, and decrements room memberCount.
 */
export async function leaveRoomHandler(
  context: AuthenticatedContext,
): Promise<{ success: true }> {
  const uid = requireCallerUid(context);
  const roomId = String(context.data.roomId ?? '').trim();
  if (!roomId) {
    throw new HttpsError('invalid-argument', 'roomId is required');
  }

  const db = getFirestore();
  const roomRef = db.doc(`rooms/${roomId}`);
  const memberRef = db.doc(`rooms/${roomId}/members/${uid}`);
  const summaryRef = db.doc(`users/${uid}/roomSummaries/${roomId}`);

  await db.runTransaction(async (transaction) => {
    const roomDoc = await transaction.get(roomRef);
    if (!roomDoc.exists) {
      throw new HttpsError('not-found', 'Room not found');
    }

    const memberDoc = await transaction.get(memberRef);
    if (!memberDoc.exists || memberDoc.data()?.active !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Caller is not an active member of this room',
      );
    }

    transaction.update(memberRef, {
      active: false,
      pets: [],
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(summaryRef, {
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(roomRef, {
      memberCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
}
