import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import type { AppUser } from '../users/user.js';
import type { ComplianceFiling } from '../database/schema.js';
import type { CreateFilingInput } from './filings.service.js';
import { FilingsService } from './filings.service.js';

@Controller('filings')
export class FilingsController {
  constructor(private readonly filings: FilingsService) {}

  @Get()
  getFilings(
    @CurrentUser() user: AppUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<ComplianceFiling[]> {
    return this.filings.findForUser(user, page, limit);
  }

  @Get(':id/audit-history')
  getAuditHistory(
    @CurrentUser() user: AppUser,
    @Param('id', ParseUUIDPipe) filingId: string,
  ) {
    return this.filings.getAuditHistory(user, filingId);
  }

  @Get('dashboard-stats')
  getDashboardStats(@CurrentUser() user: AppUser): Promise<{
    totalFilings: number;
    draftFilings: number;
    submittedFilings: number;
    approvedFilings: number;
    rejectedFilings: number;
  }> {
    return this.filings.getDashboardStats(user);
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

  @Post(':id/submit')
  submitDraft(
    @CurrentUser() user: AppUser,
    @Param('id', ParseUUIDPipe) filingId: string,
  ): Promise<ComplianceFiling> {
    return this.filings.submitDraft(user, filingId);
  }
}
