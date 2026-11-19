import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { CurrentUser, PasswordHasher, Public, SignInService } from '@nestjs/authentication';
import { UsersRepository } from '../users/users.repository.js';
import type { AppUser } from '../users/user.js';
import { SignInPipe, type SignInBody } from './sign-in.pipe.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordHasher,
    private readonly signIn: SignInService,
  ) {}

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async login(@Body(SignInPipe) body: SignInBody) {
    const found = await this.users.findCredentials(body.username);
    // An unknown account still runs the package's dummy-hash check.
    const valid = await this.passwords.verify(body.password, found?.passwordHash);
    if (!found || !valid) throw new UnauthorizedException('Invalid username or password');
    await this.signIn.signIn(found.user.id, { method: 'password' });
    return found.user;
  }

  @Get('me')
  me(@CurrentUser() user: AppUser) {
    return user;
  }

  @Public()
  @Post('sign-out')
  @HttpCode(204)
  async logout() {
    await this.signIn.signOut();
  }
}
