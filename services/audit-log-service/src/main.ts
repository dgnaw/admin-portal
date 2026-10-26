import 'reflect-metadata';
import { CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Module, Query, Req, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { authenticate, createAuthExceptionFilter, createVerifier, type Verifier } from '@platform/auth-guard';
import { config, issuers } from './config';
import { AuditStore } from './store';
import { AuditConsumer } from './consumer.service';

let verifier: Verifier | null = null;
const getVerifier = () => (verifier ??= createVerifier({ issuers: issuers() }));

@Injectable()
class ReaderGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    req.tenant = await authenticate(getVerifier(), req.headers ?? {}, { requireTenant: false });
    return true;
  }
}

@Controller('audit')
@UseGuards(ReaderGuard)
class AuditController {
  constructor(@Inject(AuditStore) private readonly store: AuditStore) {}

  @Get()
  async search(
    @Req() req: any,
    @Query('tenantId') tenantId?: string,
    @Query('actorId') actorId?: string,
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = req.tenant;
    const isSysadmin =
      principal.roles.includes('Sysadmin') || principal.clientRoles.includes('platform-admin');
    const scoped = isSysadmin ? tenantId : principal.tenantId;
    return this.store.search({ tenantId: scoped, actorId, eventType, limit: Number(limit) || undefined });
  }
}

@Module({ controllers: [AuditController], providers: [AuditStore, AuditConsumer] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const AuthExceptionFilter = createAuthExceptionFilter();
  app.useGlobalFilters(new AuthExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`audit-log-service listening on :${config.port}`);
}

bootstrap();
