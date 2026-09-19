import { describe, expect, it } from 'vitest';
import { emulatorFixture } from '../src/fixtures';

describe('emulator fixture', () => {
  it('contains users, room, members, text, image, and video records', () => {
    const fixture = emulatorFixture();
    expect(fixture.projectId).toBe('demo-pet-digit');
    expect(fixture.users.map(user => user.uid)).toEqual(['user-integration', 'user-second']);
    expect(fixture.room.roomId).toBe('room-integration');
    expect(fixture.members).toEqual([{ uid: 'user-integration' }]);
    expect(fixture.messages.map(message => message.kind)).toEqual(['text', 'image', 'video']);
  });
});
