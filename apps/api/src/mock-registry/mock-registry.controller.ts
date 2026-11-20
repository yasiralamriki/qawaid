import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { randomUUID } from 'node:crypto';

interface VerificationResult {
  identifierCr: string;
  referenceId: string;
  verifiedAt: string;
}

@Controller('mock-registry')
export class MockRegistryController {
  private readonly results = new Map<string, VerificationResult>();
  private readonly processedKeys = new Map<string, string>();

  @Public()
  @Post('verify')
  verifyFiling(
    @Body() body: { filingId: string; identifierCr: string },
    @Headers('idempotency-key') key?: string,
  ) {
    if (
      !key?.trim() ||
      !body ||
      typeof body.filingId !== 'string' ||
      !body.filingId.trim() ||
      typeof body.identifierCr !== 'string' ||
      !body.identifierCr.trim()
    ) {
      throw new BadRequestException(
        'filingId, identifierCr and Idempotency-Key are required',
      );
    }
    const fingerprint = JSON.stringify([body.filingId, body.identifierCr]);
    const previous = this.processedKeys.get(key);
    if (previous && previous !== fingerprint) {
      throw new ConflictException(
        'Idempotency key already used for another request',
      );
    }
    let result = this.results.get(body.filingId);
    if (result && result.identifierCr !== body.identifierCr) {
      throw new ConflictException(
        'Filing already verified for a different registration',
      );
    }
    // Repeated requests reuse the result instead of creating another validation.
    if (!result) {
      if (Math.random() < 0.3) {
        throw new ServiceUnavailableException(
          'Registry temporarily unavailable',
        );
      }
      result = {
        identifierCr: body.identifierCr,
        referenceId: `REG-${randomUUID()}`,
        verifiedAt: new Date().toISOString(),
      };
      this.results.set(body.filingId, result);
    }
    this.processedKeys.set(key, fingerprint);
    return {
      status: 'VERIFIED',
      referenceId: result.referenceId,
      verifiedAt: result.verifiedAt,
    };
  }
}
