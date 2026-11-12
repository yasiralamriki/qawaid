import { Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { databaseUrl } from './environment.js';
import { DatabaseController } from './database.controller.js';
import * as schema from './schema.js';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      useFactory: () => ({
        drizzle,
        connection: { connectionString: databaseUrl(), connectionTimeoutMillis: 5000 },
        schema,
      }),
    }),
  ],
  controllers: [DatabaseController],
})
export class DatabaseModule {}
