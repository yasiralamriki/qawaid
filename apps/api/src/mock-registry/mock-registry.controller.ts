import {
  Controller,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
@Controller('mock-registry')
export class MockRegistryController {
  private processedKeys = new Set<string>();
  @Post('verify')
  async verifyFiling(
    @Body() body: { filingId: string; identifierCr: string },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Simulate ~30% transient gateway failure rate
    if (Math.random() < 0.3) {
      throw new HttpException(
        {
          error: 'Service Unavailable',
          message: 'Registry network gateway timeout',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // Verify idempotency
    if (idempotencyKey && this.processedKeys.has(idempotencyKey)) {
      return {
        status: 'VERIFIED',
        message: 'Duplicate event acknowledged without re-processing',
        referenceId: `REG-${Date.now()}`,
      };
    }
    if (idempotencyKey) {
      this.processedKeys.add(idempotencyKey);
    }
    return {
      status: 'VERIFIED',
      referenceId: `REG-${Math.floor(100000 + Math.random() * 900000)}`,
      verifiedAt: new Date().toISOString(),
    };
  }
}
