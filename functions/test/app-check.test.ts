import { describe, expect, it } from 'vitest';
import { appCheckAcceptedFor, appCheckEnforcementFor } from '../src/index';

describe('App Check configuration', () => {
  const local = {
    APP_ENV: 'emulator', APP_CHECK_MODE: 'bypass', GCLOUD_PROJECT: 'demo-pet-digit',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  };

  it('bypasses only when explicit local emulator conditions all hold', () => {
    expect(appCheckEnforcementFor(local)).toBe(false);
    expect(appCheckEnforcementFor({ ...local, APP_CHECK_MODE: 'required' })).toBe(true);
    expect(appCheckEnforcementFor({ ...local, GCLOUD_PROJECT: 'staging-project' })).toBe(true);
    expect(appCheckEnforcementFor({ ...local, FIRESTORE_EMULATOR_HOST: '10.0.0.5:8080' })).toBe(true);
    expect(appCheckEnforcementFor({ ...local, FIREBASE_STORAGE_EMULATOR_HOST: undefined })).toBe(true);
  });

  it('enforces App Check for production and staging even with emulator variables', () => {
    expect(appCheckEnforcementFor({ ...local, APP_ENV: 'production' })).toBe(true);
    expect(appCheckEnforcementFor({ ...local, APP_ENV: 'staging' })).toBe(true);
    expect(appCheckEnforcementFor({})).toBe(true);
    expect(appCheckAcceptedFor({ APP_ENV: 'production' }, true)).toBe(true);
    expect(appCheckAcceptedFor({ APP_ENV: 'production' }, false)).toBe(false);
  });
});
