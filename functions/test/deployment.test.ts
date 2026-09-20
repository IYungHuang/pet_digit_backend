import { describe, expect, it } from 'vitest';
import { FIREBASE_REGION } from '../src/deployment';
import { schedulerConfigFor } from '../src/scheduler';

describe('staging deployment configuration', () => {
  it('co-locates Functions and Scheduler with Taiwan data resources', () => {
    expect(FIREBASE_REGION).toBe('asia-east1');
    expect(schedulerConfigFor({ APP_ENV: 'staging' }).region).toBe(
      FIREBASE_REGION,
    );
  });
});
