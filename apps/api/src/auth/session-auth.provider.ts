import { Injectable } from '@nestjs/common';
import { AuthenticationRegistry, SessionCookieProvider, type SessionRecord } from '@nestjs/authentication';
import { UsersRepository } from '../users/users.repository.js';
import type { AppUser } from '../users/user.js';

@Injectable()
export class SessionAuth extends SessionCookieProvider<AppUser> {
  constructor(private readonly users: UsersRepository, registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }

  validate(session: SessionRecord) {
    return this.users.findById(session.userId);
  }
}