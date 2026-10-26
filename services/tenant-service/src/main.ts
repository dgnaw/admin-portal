import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createAuthExceptionFilter } from '@platform/auth-guard';
import { config } from './config';
import { EventBus } from './events';
import { TenantService } from './tenant.service';
import { ProductController, ResolveController, TenantController } from './tenant.controller';

@Module({
  controllers: [ProductController, TenantController, ResolveController],
  providers: [TenantService, EventBus],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const AuthExceptionFilter = createAuthExceptionFilter();
  app.useGlobalFilters(new AuthExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`tenant-service listening on :${config.port}`);
}

bootstrap();
