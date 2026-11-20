import {
  MAX_REGISTRY_ATTEMPTS,
  retryDelay,
  retryableStatus,
} from './registry.worker.js';

describe('Registry retry policy', () => {
  it('makes one initial attempt and three retries after 1, 2 and 4 seconds', () => {
    expect(MAX_REGISTRY_ATTEMPTS).toBe(4);
    expect([1, 2, 3].map(retryDelay)).toEqual([1000, 2000, 4000]);
  });
  it('retries temporary responses but does not retry validation/authentication failures', () => {
    for (const status of [408, 429, 500, 502, 503, 504])
      expect(retryableStatus(status)).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 422])
      expect(retryableStatus(status)).toBe(false);
  });
});
