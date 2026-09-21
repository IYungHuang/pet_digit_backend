import { beforeEach, describe, expect, it } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';
import {
  createRoomHandler,
  leaveRoomHandler,
  registerPetHandler,
  searchUsersHandler,
  setDefaultPetHandler,
  updatePetHandler,
  updateRoomPetsHandler,
  upsertUserProfileHandler,
} from '../src/user-pet-room';
import { seedEmulatorFixture } from '../src/fixtures';

describe('User, Pet, and Room Lifecycle Integration', () => {
  beforeEach(async () => {
    await seedEmulatorFixture();
  });

  describe('User Profile and SearchTag Indexing', () => {
    const userA = 'user-prof-a';
    const userB = 'user-prof-b';

    it('creates profile and index, and blocks duplicate search tag case-insensitively', async () => {
      const profileA = await upsertUserProfileHandler({
        auth: { uid: userA },
        data: {
          nickname: 'Alice Corgi',
          avatarUrl: 'https://example.com/alice.png',
          searchTag: 'Corgi_Master',
        },
      });

      expect(profileA.uid).toBe(userA);
      expect(profileA.searchTag).toBe('Corgi_Master');
      expect(profileA.searchTagLower).toBe('corgi_master');

      const tagDoc = await getFirestore().doc('searchTags/corgi_master').get();
      expect(tagDoc.exists).toBe(true);
      expect(tagDoc.data()?.uid).toBe(userA);

      // Attempt duplicate with different casing
      await expect(
        upsertUserProfileHandler({
          auth: { uid: userB },
          data: {
            nickname: 'Bob Duplicate',
            avatarUrl: 'https://example.com/bob.png',
            searchTag: 'CORGI_MASTER',
          },
        }),
      ).rejects.toMatchObject({
        code: 'already-exists',
      });
    });

    it('cleans up old search tag when user updates search tag', async () => {
      await upsertUserProfileHandler({
        auth: { uid: userA },
        data: {
          nickname: 'Alice Original',
          avatarUrl: 'https://example.com/alice.png',
          searchTag: 'Alice_Old',
        },
      });

      const oldTag = await getFirestore().doc('searchTags/alice_old').get();
      expect(oldTag.exists).toBe(true);

      await upsertUserProfileHandler({
        auth: { uid: userA },
        data: {
          nickname: 'Alice New',
          avatarUrl: 'https://example.com/alice.png',
          searchTag: 'Alice_New',
        },
      });

      const oldTagAfter = await getFirestore().doc('searchTags/alice_old').get();
      expect(oldTagAfter.exists).toBe(false);

      const newTag = await getFirestore().doc('searchTags/alice_new').get();
      expect(newTag.exists).toBe(true);
      expect(newTag.data()?.uid).toBe(userA);
    });

    it('searches users by exact @tag and by prefix, excluding self', async () => {
      await upsertUserProfileHandler({
        auth: { uid: userA },
        data: {
          nickname: 'Alice',
          avatarUrl: 'https://example.com/alice.png',
          searchTag: 'alice_alpha',
        },
      });
      await upsertUserProfileHandler({
        auth: { uid: userB },
        data: {
          nickname: 'Bob',
          avatarUrl: 'https://example.com/bob.png',
          searchTag: 'bob_beta',
        },
      });

      // User A searches for @bob_beta
      const exactSearch = await searchUsersHandler({
        auth: { uid: userA },
        data: { query: '@bob_beta' },
      });
      expect(exactSearch).toHaveLength(1);
      expect(exactSearch[0].uid).toBe(userB);
      expect(exactSearch[0].nickname).toBe('Bob');

      // User A searches for @alice_alpha (self -> excluded)
      const selfSearch = await searchUsersHandler({
        auth: { uid: userA },
        data: { query: '@alice_alpha' },
      });
      expect(selfSearch).toHaveLength(0);

      // Prefix search
      const prefixSearch = await searchUsersHandler({
        auth: { uid: userA },
        data: { query: 'bob' },
      });
      expect(prefixSearch).toHaveLength(1);
      expect(prefixSearch[0].uid).toBe(userB);
    });
  });

  describe('Pet Management (1:N and Default Pet)', () => {
    const userA = 'user-pet-a';
    const userB = 'user-pet-b';

    it('requires user profile before registering pet', async () => {
      await expect(
        registerPetHandler({
          auth: { uid: 'unregistered-user' },
          data: {
            name: 'Ghost Pet',
            species: 'dog',
            breed: 'corgi',
            avatarUrl: 'https://example.com/ghost.png',
          },
        }),
      ).rejects.toMatchObject({
        code: 'failed-precondition',
      });
    });

    it('registers first pet and automatically assigns defaultPetId', async () => {
      await upsertUserProfileHandler({
        auth: { uid: userA },
        data: {
          nickname: 'Alice',
          avatarUrl: 'https://example.com/alice.png',
          searchTag: 'alice_corgi',
        },
      });

      const firstPet = await registerPetHandler({
        auth: { uid: userA },
        data: {
          name: 'Bobby',
          species: 'dog',
          breed: 'Pembroke Welsh Corgi',
          avatarUrl: 'https://example.com/bobby.png',
          personality: 'playful',
        },
      });

      expect(firstPet.isDefault).toBe(true);
      expect(firstPet.name).toBe('Bobby');

      const userDoc = await getFirestore().doc(`users/${userA}`).get();
      expect(userDoc.data()?.defaultPetId).toBe(firstPet.petId);

      // Register second pet without setting as default
      const secondPet = await registerPetHandler({
        auth: { uid: userA },
        data: {
          name: 'Mimi',
          species: 'cat',
          breed: 'British Shorthair',
          avatarUrl: 'https://example.com/mimi.png',
          setAsDefault: false,
        },
      });

      expect(secondPet.isDefault).toBe(false);
      const userDoc2 = await getFirestore().doc(`users/${userA}`).get();
      expect(userDoc2.data()?.defaultPetId).toBe(firstPet.petId);

      // Set second pet as default
      await setDefaultPetHandler({
        auth: { uid: userA },
        data: { petId: secondPet.petId },
      });

      const userDoc3 = await getFirestore().doc(`users/${userA}`).get();
      expect(userDoc3.data()?.defaultPetId).toBe(secondPet.petId);
    });

    it('updates pet metadata and prevents unauthorized pet mutation', async () => {
      await upsertUserProfileHandler({
        auth: { uid: userA },
        data: {
          nickname: 'Alice',
          avatarUrl: 'https://example.com/alice.png',
          searchTag: 'alice_pets',
        },
      });
      const pet = await registerPetHandler({
        auth: { uid: userA },
        data: {
          name: 'Polly',
          species: 'parrot',
          breed: 'Cockatiel',
          avatarUrl: 'https://example.com/polly.png',
        },
      });

      await updatePetHandler({
        auth: { uid: userA },
        data: {
          petId: pet.petId,
          updates: { name: 'Polly Super', personality: 'curious' },
        },
      });

      const petDoc = await getFirestore().doc(`users/${userA}/pets/${pet.petId}`).get();
      expect(petDoc.data()?.name).toBe('Polly Super');
      expect(petDoc.data()?.personality).toBe('curious');

      // User B cannot update User A's pet
      await expect(
        updatePetHandler({
          auth: { uid: userB },
          data: {
            petId: pet.petId,
            updates: { name: 'Hacked' },
          },
        }),
      ).rejects.toMatchObject({
        code: 'not-found',
      });
    });
  });

  describe('Room Lifecycle and Multi-Pet Scheduling', () => {
    const userA = 'user-room-a';
    const userB = 'user-room-b';
    const userC = 'user-room-c';

    beforeEach(async () => {
      // Setup User A with Pet A
      await upsertUserProfileHandler({
        auth: { uid: userA },
        data: { nickname: 'Alice', avatarUrl: 'https://example.com/alice.png', searchTag: 'alice_room' },
      });
      await registerPetHandler({
        auth: { uid: userA },
        data: {
          name: 'Doggo A',
          species: 'dog',
          breed: 'Corgi',
          avatarUrl: 'https://example.com/corgi.png',
          setAsDefault: true,
        },
      });

      // Setup User B with Pet B
      await upsertUserProfileHandler({
        auth: { uid: userB },
        data: { nickname: 'Bob', avatarUrl: 'https://example.com/bob.png', searchTag: 'bob_room' },
      });
      await registerPetHandler({
        auth: { uid: userB },
        data: {
          name: 'Catto B',
          species: 'cat',
          breed: 'Persian',
          avatarUrl: 'https://example.com/persian.png',
          setAsDefault: true,
        },
      });
    });

    it('establishes 1v1 direct room with deterministic ID and default pet snapshots', async () => {
      const room = await createRoomHandler({
        auth: { uid: userA },
        data: { type: 'direct', inviteeUids: [userB] },
      });

      expect(room.type).toBe('direct');
      expect(room.roomId).toBe(`dm_${[userA, userB].sort().join('_')}`);
      expect(room.memberCount).toBe(2);
      expect(room.existed).toBe(false);

      // Member A has Doggo A
      const memberADoc = await getFirestore().doc(`rooms/${room.roomId}/members/${userA}`).get();
      expect(memberADoc.data()?.active).toBe(true);
      expect(memberADoc.data()?.pets).toHaveLength(1);
      expect(memberADoc.data()?.pets[0].name).toBe('Doggo A');

      // Member B has Catto B
      const memberBDoc = await getFirestore().doc(`rooms/${room.roomId}/members/${userB}`).get();
      expect(memberBDoc.data()?.active).toBe(true);
      expect(memberBDoc.data()?.pets).toHaveLength(1);
      expect(memberBDoc.data()?.pets[0].name).toBe('Catto B');

      // User A's roomSummary has Bob's name
      const summaryADoc = await getFirestore().doc(`users/${userA}/roomSummaries/${room.roomId}`).get();
      expect(summaryADoc.data()?.name).toBe('Bob');
      expect(summaryADoc.data()?.avatarUrl).toBe('https://example.com/bob.png');

      // Re-invoking createRoom returns existing room
      const secondCreate = await createRoomHandler({
        auth: { uid: userB },
        data: { type: 'direct', inviteeUids: [userA] },
      });
      expect(secondCreate.roomId).toBe(room.roomId);
      expect(secondCreate.existed).toBe(true);
    });

    it('establishes group room with owner and member roles', async () => {
      await upsertUserProfileHandler({
        auth: { uid: userC },
        data: { nickname: 'Charlie', avatarUrl: 'https://example.com/charlie.png', searchTag: 'charlie_room' },
      });

      const group = await createRoomHandler({
        auth: { uid: userA },
        data: {
          type: 'group',
          name: 'Pet Lovers Club',
          avatarUrl: 'https://example.com/club.png',
          inviteeUids: [userB, userC],
        },
      });

      expect(group.type).toBe('group');
      expect(group.memberCount).toBe(3);

      const ownerDoc = await getFirestore().doc(`rooms/${group.roomId}/members/${userA}`).get();
      expect(ownerDoc.data()?.role).toBe('owner');

      const memberDoc = await getFirestore().doc(`rooms/${group.roomId}/members/${userB}`).get();
      expect(memberDoc.data()?.role).toBe('member');

      const summaryDoc = await getFirestore().doc(`users/${userC}/roomSummaries/${group.roomId}`).get();
      expect(summaryDoc.data()?.name).toBe('Pet Lovers Club');
      expect(summaryDoc.data()?.avatarUrl).toBe('https://example.com/club.png');
    });

    it('schedules multi-pet deployment in room with updateRoomPets', async () => {
      // User A registers a second pet (cat)
      const secondPet = await registerPetHandler({
        auth: { uid: userA },
        data: {
          name: 'Kitty A2',
          species: 'cat',
          breed: 'Siamese',
          avatarUrl: 'https://example.com/siamese.png',
          setAsDefault: false,
        },
      });

      const room = await createRoomHandler({
        auth: { uid: userA },
        data: { type: 'direct', inviteeUids: [userB] },
      });

      const userADoc = await getFirestore().doc(`users/${userA}`).get();
      const firstPetId = userADoc.data()?.defaultPetId as string;

      // Deploy both pets into the room
      const updateResult = await updateRoomPetsHandler({
        auth: { uid: userA },
        data: {
          roomId: room.roomId,
          petIds: [firstPetId, secondPet.petId],
        },
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.activePets).toHaveLength(2);

      const memberDoc = await getFirestore().doc(`rooms/${room.roomId}/members/${userA}`).get();
      expect(memberDoc.data()?.pets).toHaveLength(2);
      expect(memberDoc.data()?.pets.map((p: { name: string }) => p.name)).toEqual(['Doggo A', 'Kitty A2']);

      // Attempt deploying someone else's pet fails
      const userBDoc = await getFirestore().doc(`users/${userB}`).get();
      const foreignPetId = userBDoc.data()?.defaultPetId as string;

      await expect(
        updateRoomPetsHandler({
          auth: { uid: userA },
          data: {
            roomId: room.roomId,
            petIds: [foreignPetId],
          },
        }),
      ).rejects.toMatchObject({
        code: 'not-found',
      });
    });

    it('handles member leaving room: deactivates member, clears pets, updates summary and count', async () => {
      const room = await createRoomHandler({
        auth: { uid: userA },
        data: { type: 'direct', inviteeUids: [userB] },
      });

      await leaveRoomHandler({
        auth: { uid: userA },
        data: { roomId: room.roomId },
      });

      const memberDoc = await getFirestore().doc(`rooms/${room.roomId}/members/${userA}`).get();
      expect(memberDoc.data()?.active).toBe(false);
      expect(memberDoc.data()?.pets).toEqual([]);

      const summaryDoc = await getFirestore().doc(`users/${userA}/roomSummaries/${room.roomId}`).get();
      expect(summaryDoc.data()?.active).toBe(false);

      const roomDoc = await getFirestore().doc(`rooms/${room.roomId}`).get();
      expect(roomDoc.data()?.memberCount).toBe(1);

      // Inactive member cannot deploy pets
      await expect(
        updateRoomPetsHandler({
          auth: { uid: userA },
          data: { roomId: room.roomId, petIds: [] },
        }),
      ).rejects.toMatchObject({
        code: 'permission-denied',
      });
    });
  });
});
