import { describe, expect, it } from 'vitest';
import {
  deterministicDmRoomId,
  validateAvatarUrl,
  validateNickname,
  validatePetBreed,
  validatePetGender,
  validatePetName,
  validatePetPersonality,
  validatePetSpecies,
  validatePhotoUrls,
  validateSearchTag,
} from '../src/user-pet-room-contracts';

describe('user-pet-room contracts and validators', () => {
  describe('validateNickname', () => {
    it('accepts valid nicknames', () => {
      expect(validateNickname(' Alice ')).toBe('Alice');
      expect(validateNickname('A'.repeat(30))).toHaveLength(30);
    });

    it('rejects empty or whitespace nicknames', () => {
      expect(() => validateNickname('')).toThrowError(/Nickname is required/);
      expect(() => validateNickname('   ')).toThrowError(/Nickname is required/);
      expect(() => validateNickname(null)).toThrowError(/Nickname is required/);
    });

    it('rejects nicknames longer than 30 characters', () => {
      expect(() => validateNickname('A'.repeat(31))).toThrowError(/at most 30 characters/);
    });
  });

  describe('validateAvatarUrl', () => {
    it('accepts valid avatar URLs', () => {
      expect(validateAvatarUrl(' https://example.com/avatar.png ')).toBe(
        'https://example.com/avatar.png',
      );
    });

    it('rejects empty or non-string URLs', () => {
      expect(() => validateAvatarUrl('')).toThrowError(/Avatar URL is required/);
      expect(() => validateAvatarUrl(null)).toThrowError(/Avatar URL is required/);
    });
  });

  describe('validatePhotoUrls', () => {
    it('returns empty array when null or undefined', () => {
      expect(validatePhotoUrls(null)).toEqual([]);
      expect(validatePhotoUrls(undefined)).toEqual([]);
    });

    it('accepts valid photo URLs array and trims strings', () => {
      const input = [' https://example.com/photo1.jpg ', 'https://example.com/photo2.jpg'];
      expect(validatePhotoUrls(input)).toEqual([
        'https://example.com/photo1.jpg',
        'https://example.com/photo2.jpg',
      ]);
    });

    it('rejects non-array input', () => {
      expect(() => validatePhotoUrls('not-an-array')).toThrowError(/must be an array/);
      expect(() => validatePhotoUrls(123)).toThrowError(/must be an array/);
    });

    it('rejects arrays with non-string or empty elements', () => {
      expect(() => validatePhotoUrls(['https://valid.com', ''])).toThrowError(/must be a non-empty string/);
      expect(() => validatePhotoUrls([123])).toThrowError(/must be a non-empty string/);
    });

    it('rejects exceeding 20 photos limit', () => {
      const overLimit = Array.from({ length: 21 }, (_, i) => `https://example.com/photo${i}.jpg`);
      expect(() => validatePhotoUrls(overLimit)).toThrowError(/cannot exceed 20 photos/);
    });
  });

  describe('validateSearchTag', () => {
    it('accepts valid search tags and returns original + lowercase', () => {
      const result = validateSearchTag('Corgi_Master_99');
      expect(result.original).toBe('Corgi_Master_99');
      expect(result.lower).toBe('corgi_master_99');
    });

    it('accepts boundary length 3 and 20', () => {
      expect(validateSearchTag('abc').lower).toBe('abc');
      expect(validateSearchTag('a'.repeat(20)).lower).toBe('a'.repeat(20));
    });

    it('rejects invalid lengths or characters', () => {
      expect(() => validateSearchTag('ab')).toThrowError(/3-20 characters/);
      expect(() => validateSearchTag('a'.repeat(21))).toThrowError(/3-20 characters/);
      expect(() => validateSearchTag('has space')).toThrowError(/letters, numbers, and underscores/);
      expect(() => validateSearchTag('has-hyphen')).toThrowError(/letters, numbers, and underscores/);
      expect(() => validateSearchTag('tag@symbol')).toThrowError(/letters, numbers, and underscores/);
    });
  });

  describe('pet validation', () => {
    it('validates pet name', () => {
      expect(validatePetName(' Bobby ')).toBe('Bobby');
      expect(() => validatePetName('')).toThrowError(/Pet name is required/);
      expect(() => validatePetName('B'.repeat(31))).toThrowError(/at most 30 characters/);
    });

    it('validates pet species', () => {
      expect(validatePetSpecies('dog')).toBe('dog');
      expect(validatePetSpecies('cat')).toBe('cat');
      expect(validatePetSpecies('parrot')).toBe('parrot');
      expect(() => validatePetSpecies('hamster')).toThrowError(/Pet species must be one of/);
    });

    it('validates pet breed', () => {
      expect(validatePetBreed(' Corgi ')).toBe('Corgi');
      expect(() => validatePetBreed('')).toThrowError(/Pet breed is required/);
      expect(() => validatePetBreed('C'.repeat(51))).toThrowError(/at most 50 characters/);
    });

    it('validates pet gender', () => {
      expect(validatePetGender(null)).toBe('unknown');
      expect(validatePetGender(undefined)).toBe('unknown');
      expect(validatePetGender('male')).toBe('male');
      expect(validatePetGender('female')).toBe('female');
      expect(validatePetGender('neutered')).toBe('neutered');
      expect(validatePetGender('unknown')).toBe('unknown');
      expect(() => validatePetGender('other')).toThrowError(/Pet gender must be one of/);
    });

    it('validates pet personality', () => {
      expect(validatePetPersonality(null)).toBe('playful');
      expect(validatePetPersonality('')).toBe('playful');
      expect(validatePetPersonality(' curious ')).toBe('curious');
      expect(() => validatePetPersonality('P'.repeat(51))).toThrowError(/at most 50 characters/);
    });
  });

  describe('deterministicDmRoomId', () => {
    it('sorts user IDs deterministically', () => {
      expect(deterministicDmRoomId('user-b', 'user-a')).toBe('dm_user-a_user-b');
      expect(deterministicDmRoomId('user-a', 'user-b')).toBe('dm_user-a_user-b');
      expect(deterministicDmRoomId('uid-99', 'uid-10')).toBe('dm_uid-10_uid-99');
    });

    it('rejects identical user IDs or missing IDs', () => {
      expect(() => deterministicDmRoomId('user-a', 'user-a')).toThrowError(
        /requires two distinct user IDs/,
      );
      expect(() => deterministicDmRoomId('', 'user-a')).toThrowError(
        /requires two distinct user IDs/,
      );
    });
  });
});
