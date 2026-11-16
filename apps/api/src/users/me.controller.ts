import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import type { AppUser } from './user.js';

@Controller('me')
export class MeController {
  @Get()
  getMe(@CurrentUser() user: AppUser): AppUser {
    return user;
  }
}