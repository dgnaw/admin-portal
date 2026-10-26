import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { authenticate, createVerifier, type TenantPrincipal, type Verifier } from '@platform/auth-guard';
import { config, issuers } from './config';

let verifier: Verifier | null = null;
const getVerifier = () => (verifier ??= createVerifier({ issuers: issuers(), audience: 'admin-portal' }));

function attach(req: any, principal: TenantPrincipal) {
  req.tenant = principal;
  return principal;
}

@Injectable()
export class SysadminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const principal = await authenticate(getVerifier(), req.headers ?? {}, {
      requireTenant: false,
      roles: ['Sysadmin', 'platform-admin'],
    });
    attach(req, principal);
    return true;
  }
}

@Injectable()
export class TenantScopedGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const principal = await authenticate(getVerifier(), req.headers ?? {}, { requireTenant: false });
    attach(req, principal);

    const target = req.params?.tenantId;
    if (!target) return true;

    const isSysadmin = principal.roles.includes('Sysadmin') || principal.clientRoles.includes('platform-admin');
    if (isSysadmin) return true;

    if (principal.tenantId !== target) {
      throw new ForbiddenException(
        `Token thuoc ${principal.tenantId ?? 'khong tenant nao'}, khong duoc thao tac tren ${target}`,
      );
    }
    return true;
  }
}

export function actorOf(req: any) {
  const p = req.tenant as TenantPrincipal | undefined;
  if (!p) return { actorType: 'system' as const, actorId: 'system' };
  return p.isServiceAccount
    ? { actorType: 'service' as const, actorId: (req.headers?.['x-origin-actor'] as string) ?? p.sub }
    : { actorType: 'user' as const, actorId: p.sub };
}

export { config };
