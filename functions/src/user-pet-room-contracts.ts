import { HttpsError } from 'firebase-functions/v2/https';

export type PetSpecies = 'dog' | 'cat' | 'parrot';
export type PetGender = 'male' | 'female' | 'neutered' | 'unknown';
export type RoomType = 'direct' | 'group';
export type RoomMemberRole = 'owner' | 'admin' | 'member';

export const ALLOWED_SPECIES: ReadonlySet<PetSpecies> = new Set(['dog', 'cat', 'parrot']);
export const ALLOWED_GENDERS: ReadonlySet<PetGender> = new Set(['male', 'female', 'neutered', 'unknown']);
export const SEARCH_TAG_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export type UserProfile = {
  uid: string;
  nickname: string;
  avatarUrl: string;
  searchTag: string;
  searchTagLower: string;
  defaultPetId: string;
  basePetSlots?: number;
  invitedBonusSlots?: number;
  paidBonusSlots?: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type SearchTagIndex = {
  searchTag: string;
  searchTagLower: string;
  uid: string;
  createdAt: string;
};

export type PetProfile = {
  petId: string;
  ownerUid: string;
  name: string;
  species: PetSpecies;
  breed: string;
  avatarUrl: string;
  photoUrls?: string[];
  gender: PetGender;
  personality: string;
  birthday?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type PetRoomSnapshot = {
  petId: string;
  name: string;
  species: PetSpecies;
  breed: string;
  avatarUrl: string;
  personality: string;
};

export type RoomDocument = {
  roomId: string;
  type: RoomType;
  name: string;
  avatarUrl?: string | null;
  createdBy: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessage?: {
    text: string;
    senderId: string;
    kind: string;
    createdAt: string;
  } | null;
  [key: string]: unknown;
};

export type RoomMember = {
  uid: string;
  role: RoomMemberRole;
  active: boolean;
  joinedAt: string;
  pets: PetRoomSnapshot[];
  [key: string]: unknown;
};

export type RoomSummary = {
  roomId: string;
  type: RoomType;
  name: string;
  avatarUrl?: string | null;
  unreadCount: number;
  active: boolean;
  updatedAt: string;
  lastMessageText?: string | null;
  lastMessageSenderId?: string | null;
  lastMessageAt?: string | null;
  [key: string]: unknown;
};

export function validateNickname(nickname: unknown): string {
  if (typeof nickname !== 'string' || nickname.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Nickname is required and cannot be empty');
  }
  const trimmed = nickname.trim();
  if (trimmed.length > 30) {
    throw new HttpsError('invalid-argument', 'Nickname must be at most 30 characters');
  }
  return trimmed;
}

export function validateAvatarUrl(avatarUrl: unknown): string {
  if (typeof avatarUrl !== 'string' || avatarUrl.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Avatar URL is required and cannot be empty');
  }
  return avatarUrl.trim();
}

export function validatePhotoUrls(photoUrls: unknown): string[] {
  if (photoUrls === undefined || photoUrls === null) return [];
  if (!Array.isArray(photoUrls)) {
    throw new HttpsError('invalid-argument', 'photoUrls must be an array of string URLs');
  }
  if (photoUrls.length > 20) {
    throw new HttpsError('invalid-argument', 'photoUrls cannot exceed 20 photos');
  }
  return photoUrls.map((item, idx) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new HttpsError('invalid-argument', `photoUrls item at index ${idx} must be a non-empty string`);
    }
    return item.trim();
  });
}

export function validateSearchTag(searchTag: unknown): { original: string; lower: string } {
  if (typeof searchTag !== 'string' || !SEARCH_TAG_REGEX.test(searchTag)) {
    throw new HttpsError(
      'invalid-argument',
      'Search tag must be 3-20 characters long and contain only letters, numbers, and underscores',
    );
  }
  return {
    original: searchTag,
    lower: searchTag.toLowerCase(),
  };
}

export function validatePetName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Pet name is required and cannot be empty');
  }
  const trimmed = name.trim();
  if (trimmed.length > 30) {
    throw new HttpsError('invalid-argument', 'Pet name must be at most 30 characters');
  }
  return trimmed;
}

export function validatePetSpecies(species: unknown): PetSpecies {
  if (typeof species !== 'string' || !ALLOWED_SPECIES.has(species as PetSpecies)) {
    throw new HttpsError(
      'invalid-argument',
      `Pet species must be one of: ${Array.from(ALLOWED_SPECIES).join(', ')}`,
    );
  }
  return species as PetSpecies;
}

export function validatePetBreed(breed: unknown): string {
  if (typeof breed !== 'string' || breed.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Pet breed is required and cannot be empty');
  }
  const trimmed = breed.trim();
  if (trimmed.length > 50) {
    throw new HttpsError('invalid-argument', 'Pet breed must be at most 50 characters');
  }
  return trimmed;
}

export function validatePetGender(gender: unknown): PetGender {
  if (gender == null) return 'unknown';
  if (typeof gender !== 'string' || !ALLOWED_GENDERS.has(gender as PetGender)) {
    throw new HttpsError(
      'invalid-argument',
      `Pet gender must be one of: ${Array.from(ALLOWED_GENDERS).join(', ')}`,
    );
  }
  return gender as PetGender;
}

export function validatePetPersonality(personality: unknown): string {
  if (personality == null || personality === '') return 'playful';
  if (typeof personality !== 'string') {
    throw new HttpsError('invalid-argument', 'Pet personality must be a string');
  }
  const trimmed = personality.trim();
  if (trimmed.length > 50) {
    throw new HttpsError('invalid-argument', 'Pet personality must be at most 50 characters');
  }
  return trimmed;
}

export function deterministicDmRoomId(uidA: string, uidB: string): string {
  if (!uidA || !uidB || uidA === uidB) {
    throw new HttpsError('invalid-argument', 'Direct message requires two distinct user IDs');
  }
  const sorted = [uidA, uidB].sort();
  return `dm_${sorted[0]}_${sorted[1]}`;
}
