import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { normalizeUsername } from '../users/user.js';

export interface SignInBody { username: string; password: string }

@Injectable()
export class SignInPipe implements PipeTransform<unknown, SignInBody> {
  transform(value: unknown): SignInBody {
    if (!value || typeof value !== 'object') throw new BadRequestException('Invalid login input');
    const { username, password } = value as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new BadRequestException('Username and password are required');
    }
    const normalized = normalizeUsername(username);
    if (!normalized || normalized.length > 120 || !password || password.length > 1024) {
      throw new BadRequestException('Invalid username or password length');
    }
    return { username: normalized, password };
  }
}