import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { MockRegistryController } from './mock-registry.controller.js';

const body = { filingId: 'example-filing', identifierCr: 'DEMO-ARAM' };
afterEach(() => vi.restoreAllMocks());
describe('Mock registry', () => {
  it('simulates a 503 when the random value is below 0.3', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.29);
    expect(() => new MockRegistryController().verifyFiling(body, 'filing-example-1')).toThrow(ServiceUnavailableException);
  });
  it('returns the same result for duplicates and later attempts', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const controller = new MockRegistryController();
    const result = controller.verifyFiling(body, 'filing-example-1');
    random.mockReturnValue(0.1);
    expect(controller.verifyFiling(body, 'filing-example-1')).toEqual(result);
    expect(controller.verifyFiling(body, 'filing-example-2')).toEqual(result);
  });
  it('rejects a reused key with different data', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const controller = new MockRegistryController();
    controller.verifyFiling(body, 'same-key');
    expect(() => controller.verifyFiling({ ...body, filingId: 'another-filing' }, 'same-key')).toThrow(ConflictException);
  });
  it('requires the idempotency header', () => {
    expect(() => new MockRegistryController().verifyFiling(body)).toThrow(BadRequestException);
  });
});
