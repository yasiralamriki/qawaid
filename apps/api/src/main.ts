import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', { exclude: ['mock-registry/verify'] });
  app.enableShutdownHooks();
  app.enableCsrfProtection({ trustedOrigins: [process.env.WEB_ORIGIN ?? 'http://localhost:3000']})
  await app.listen(process.env.PORT ?? 4000);
}

await bootstrap();
