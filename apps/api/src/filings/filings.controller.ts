import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import type { AppUser } from '../users/user.js';
import type { ComplianceFiling } from '../database/schema.js';
import type { CreateFilingInput } from './filings.service.js';
import { FilingsService } from './filings.service.js';

@Controller('filings')
export class FilingsController {
  constructor(private readonly filings: FilingsService) {}

  @Get()
  getFilings(@CurrentUser() user: AppUser): Promise<ComplianceFiling[]> {
    return this.filings.findForUser(user);
  }

  @Post()
  createDraft(
    @CurrentUser() user: AppUser,
    @Body() input: CreateFilingInput,
  ): Promise<ComplianceFiling> {
    return this.filings.createDraft(user, input);
  }

  @Post('submit-new')
  createAndSubmit(
    @CurrentUser() user: AppUser,
    @Body() input: CreateFilingInput,
  ): Promise<ComplianceFiling> {
    return this.filings.createDraftForReview(user, input);
  }
}
