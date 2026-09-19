import { describe, expect, it } from 'vitest';
import { appCheckEnforcementFor } from '../src/index';

describe('App Check configuration', () => {
  it('bypasses only when local emulator hosts are explicitly present', () => {
    expect(appCheckEnforcementFor({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBe(false);
    expect(appCheckEnforcementFor({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toBe(false);
  });

  it('enforces App Check when production configuration has no emulator bypass', () => {
    expect(appCheckEnforcementFor({ NODE_ENV: 'production' })).toBe(true);
    expect(appCheckEnforcementFor({})).toBe(true);
  });
});
