import { AuthError, type TenantPrincipal } from './types';
import { bearerFrom } from './express';
import type { ServiceTokenProvider } from './service-token';

export interface AuditActor {
  actorType: 'user' | 'service';
  actorId: string;
  actorName?: string;
  onBehalfOf?: string;
  tenantId: string | null;
}

export function isServiceAccount(principal: TenantPrincipal): boolean {
  return principal.isServiceAccount;
}

export function assertUserFlow(principal: TenantPrincipal): void {
  if (principal.isServiceAccount) {
    throw new AuthError(
      'SERVICE_TOKEN_NOT_ALLOWED',
      403,
      `Luong thay mat nguoi dung khong chap nhan service token (${principal.clientId}). ` +
        'ADR-28 cam dung token he thong de muon quyen cao hon.',
    );
  }
}

export function relayHeaders(
  headers: Record<string, unknown>,
  principal: TenantPrincipal,
  extra: Record<string, string> = {},
): Record<string, string> {
  assertUserFlow(principal);
  return { Authorization: `Bearer ${bearerFrom(headers)}`, ...extra };
}

export function createRelay(principalKey = 'tenant') {
  return function relay(req: any, extra: Record<string, string> = {}): Record<string, string> {
    const principal = req?.[principalKey] as TenantPrincipal | undefined;
    if (!principal) {
      throw new AuthError('MISSING_TOKEN', 500, `Chua co principal tren req.${principalKey}`);
    }
    return relayHeaders(req.headers ?? {}, principal, extra);
  };
}

export async function systemHeaders(
  provider: ServiceTokenProvider,
  realm: string,
  originActor?: AuditActor,
): Promise<Record<string, string>> {
  const headers = await provider.authHeader(realm);
  if (originActor) headers['X-Origin-Actor'] = originActor.actorId;
  return headers;
}

export function auditActor(principal: TenantPrincipal, originActorId?: string): AuditActor {
  if (principal.isServiceAccount) {
    if (!originActorId) {
      throw new AuthError(
        'MISSING_ORIGIN_ACTOR',
        500,
        'Luong chay bang service token phai mang actor goc la nguoi cham ngoi (ADR-8, ADR-28), ' +
          'khong duoc ghi actor la service.',
      );
    }
    return {
      actorType: 'service',
      actorId: originActorId,
      actorName: principal.clientId,
      onBehalfOf: principal.clientId,
      tenantId: principal.tenantId,
    };
  }

  return {
    actorType: 'user',
    actorId: principal.sub,
    actorName: principal.username,
    tenantId: principal.tenantId,
  };
}
