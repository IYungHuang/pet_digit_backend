import { describe, expect, it } from 'vitest';
import { schedulerConfigFor } from '../src/scheduler';

describe('cleanup scheduler configuration', () => {
  it('keeps all schedules enabled outside local mode and exposes TTLs', () => {
    const config = schedulerConfigFor({ APP_ENV: 'production' });
    expect(config.recoverySchedule).toBeTruthy();
    expect(config.stagingSchedule).toBeTruthy();
    expect(config.finalizedSchedule).toBeTruthy();
    expect(config.requestLeaseMs).toBeGreaterThan(0);
    expect(config.stagingTtlMs).toBeGreaterThan(0);
    expect(config.finalizedGraceMs).toBeGreaterThan(0);
  });
});
