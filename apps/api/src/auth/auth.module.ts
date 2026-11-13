import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { DrizzleSessionStore } from './drizzle-session.store.js';
import { SessionAuth } from './session-auth.provider.js';
import { SignInPipe } from './sign-in.pipe.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [DrizzleSessionStore, SessionAuth, SignInPipe],
})
export class AuthModule {}