import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { FilingsModule } from './filings/filings.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthenticationModule.forRoot({
      session: {
        absoluteTtl: '7d',
        idleTtl: '1d',
        trustedOrigins: ['http://localhost:3000'],
      },
    }),
    AuthModule,
    FilingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
