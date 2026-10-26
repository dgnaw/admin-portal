import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { AuthError, type AuthGuardConfig, type TenantPrincipal } from './types';
import {
  DEFAULT_ALIAS_PATTERN,
  DEFAULT_SEPARATOR,
  buildCompositeUserId,
  detectServiceAccount,
  extractClientRoles,
  extractRoles,
  realmFromIssuer,
  resolveOrganization,
} from './tenant';

type JWKSet = ReturnType<typeof createRemoteJWKSet>;

export interface Verifier {
  verify(token: string): Promise<TenantPrincipal>;
  realms(): string[];
}

export function createVerifier(config: AuthGuardConfig): Verifier {
  if (!config.issuers?.length) {
    throw new Error('auth-guard: can it nhat mot issuer trong danh sach cho phep');
  }

  const separator = config.separator ?? DEFAULT_SEPARATOR;
  const aliasPattern = config.aliasPattern ?? DEFAULT_ALIAS_PATTERN;
  const allowed = new Map<string, { realm: string; jwks: JWKSet }>();

  for (const raw of config.issuers) {
    const issuer = raw.replace(/\/+$/, '');
    const realm = realmFromIssuer(issuer);
    if (separator && realm.includes(separator)) {
      throw new Error(
        `auth-guard: ten realm "${realm}" chua dau phan cach "${separator}", ` +
          'tenant_id se khong parse nguoc duoc',
      );
    }
    allowed.set(issuer, {
      realm,
      jwks: createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`), {
        cacheMaxAge: config.jwksCacheMaxAgeMs ?? 10 * 60 * 1000,
        cooldownDuration: config.jwksCooldownMs ?? 30 * 1000,
      }),
    });
  }

  async function verify(token: string): Promise<TenantPrincipal> {
    if (!token) throw new AuthError('MISSING_TOKEN', 401, 'Thieu bearer token');

    let unverified: JWTPayload;
    try {
      unverified = decodeJwt(token);
    } catch {
      throw new AuthError('MALFORMED_TOKEN', 401, 'Token khong phai JWT hop le');
    }

    const issuer = (unverified.iss ?? '').replace(/\/+$/, '');
    const entry = allowed.get(issuer);
    if (!entry) {
      throw new AuthError('UNKNOWN_ISSUER', 401, `Issuer khong nam trong danh sach cho phep: ${issuer}`);
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, entry.jwks, {
        issuer,
        audience: config.audience,
        clockTolerance: config.clockToleranceSec ?? 5,
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw new AuthError('TOKEN_EXPIRED', 401, 'Token het han');
      }
      if (err instanceof joseErrors.JWTClaimValidationFailed && err.claim === 'aud') {
        throw new AuthError('INVALID_AUDIENCE', 401, 'Token sai audience');
      }
      throw new AuthError('INVALID_SIGNATURE', 401, 'Khong xac thuc duoc chu ky token');
    }

    const claims = payload as Record<string, unknown>;
    const clientId = (claims['client_id'] ?? claims['azp']) as string | undefined;
    const org = resolveOrganization(claims['organization'], {
      realm: entry.realm,
      separator,
      aliasPattern,
      allowDerivedTenantId: config.allowDerivedTenantId,
    });
    const tenantId = org ? org.compositeTenantId : null;

    return {
      realm: entry.realm,
      org,
      sub: String(payload.sub),
      username: claims['preferred_username'] as string | undefined,
      email: claims['email'] as string | undefined,
      roles: extractRoles(claims),
      clientRoles: extractClientRoles(claims, clientId),
      clientId,
      isServiceAccount: detectServiceAccount(claims),
      tenantId,
      compositeUserId: tenantId ? buildCompositeUserId(tenantId, String(payload.sub), separator) : null,
      claims,
    };
  }

  return { verify, realms: () => [...allowed.values()].map((e) => e.realm) };
}

export function requireTenant(principal: TenantPrincipal): asserts principal is TenantPrincipal & {
  org: NonNullable<TenantPrincipal['org']>;
  tenantId: string;
  compositeUserId: string;
} {
  if (!principal.tenantId) {
    throw new AuthError(
      'NO_ORGANIZATION',
      403,
      `User ${principal.sub} khong thuoc organization nao trong realm ${principal.realm}`,
    );
  }
}

export function requireRoles(principal: TenantPrincipal, roles: string[]): void {
  if (roles.length === 0) return;
  const available = [...principal.roles, ...principal.clientRoles];
  if (!roles.some((r) => available.includes(r))) {
    throw new AuthError(
      'FORBIDDEN_ROLE',
      403,
      `Can mot trong cac role [${roles.join(', ')}], token chi co [${available.join(', ')}]`,
    );
  }
}
