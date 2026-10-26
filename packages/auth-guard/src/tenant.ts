import { AuthError, type OrganizationContext } from './types';

export const DEFAULT_SEPARATOR = '_';
export const DEFAULT_ALIAS_PATTERN = /^[A-Za-z0-9]+$/;

export interface ResolveOptions {
  realm: string;
  separator?: string;
  aliasPattern?: RegExp;
  allowDerivedTenantId?: boolean;
}

export function realmFromIssuer(issuer: string): string {
  const match = /\/realms\/([^/]+)\/?$/.exec(issuer);
  if (!match) {
    throw new AuthError('UNKNOWN_ISSUER', 401, `Issuer khong dung dinh dang Keycloak: ${issuer}`);
  }
  return match[1];
}

export function resolveOrganization(
  claim: unknown,
  options: ResolveOptions,
): OrganizationContext | null {
  const separator = options.separator ?? DEFAULT_SEPARATOR;
  const aliasPattern = options.aliasPattern ?? DEFAULT_ALIAS_PATTERN;
  const entries = normalizeOrganizationClaim(claim);

  if (entries.length === 0) return null;
  if (entries.length > 1) {
    throw new AuthError(
      'AMBIGUOUS_ORGANIZATION',
      400,
      `Token thuoc ${entries.length} organization (${entries.map((e) => e.alias).join(', ')}). ` +
        'Gui lai voi scope "organization:<alias>" de chon dung mot to chuc.',
    );
  }

  const { alias, attributes } = entries[0];
  if (!aliasPattern.test(alias)) {
    throw new AuthError(
      'INVALID_ALIAS',
      400,
      `Organization alias "${alias}" khong hop le (yeu cau ${aliasPattern}).`,
    );
  }

  const fromClaim = first(attributes['composite_tenant_id']);
  let compositeTenantId = fromClaim;

  if (!compositeTenantId) {
    if (!options.allowDerivedTenantId) {
      throw new AuthError(
        'TENANT_ID_MISSING',
        403,
        `Organization "${alias}" khong co thuoc tinh composite_tenant_id trong token. ` +
          'Tenant Service phai sinh ma nay; bat addOrganizationAttributes tren organization mapper.',
      );
    }
    compositeTenantId = `${options.realm}${separator}${alias}`;
  } else {
    const expected = `${options.realm}${separator}${alias}`;
    if (compositeTenantId !== expected) {
      throw new AuthError(
        'TENANT_ID_MISMATCH',
        403,
        `composite_tenant_id "${compositeTenantId}" khong khop realm/alias cua token ("${expected}").`,
      );
    }
  }

  return {
    alias,
    id: first(attributes['id']),
    compositeTenantId,
    productCode: first(attributes['product_code']),
    tenantCode: first(attributes['tenant_code']),
    isRootTenant: first(attributes['is_root_tenant']) === 'true',
  };
}

interface ClaimEntry {
  alias: string;
  attributes: Record<string, unknown>;
}

function normalizeOrganizationClaim(claim: unknown): ClaimEntry[] {
  if (claim == null) return [];
  if (typeof claim === 'string') return [{ alias: claim, attributes: {} }];
  if (Array.isArray(claim)) {
    return claim
      .filter((v): v is string => typeof v === 'string')
      .map((alias) => ({ alias, attributes: {} }));
  }
  if (typeof claim === 'object') {
    return Object.entries(claim as Record<string, unknown>).map(([alias, value]) => ({
      alias,
      attributes: value && typeof value === 'object' ? (value as Record<string, unknown>) : {},
    }));
  }
  return [];
}

function first(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function buildCompositeUserId(
  tenantId: string,
  sub: string,
  separator: string = DEFAULT_SEPARATOR,
): string {
  return `${tenantId}${separator}${sub}`;
}

export function parseTenantId(
  tenantId: string,
  separator: string = DEFAULT_SEPARATOR,
): { realm: string; orgAlias: string } {
  const idx = tenantId.indexOf(separator);
  if (idx <= 0 || idx === tenantId.length - 1) {
    throw new AuthError('INVALID_ALIAS', 400, `tenant_id khong hop le: ${tenantId}`);
  }
  return { realm: tenantId.slice(0, idx), orgAlias: tenantId.slice(idx + separator.length) };
}

export function extractClientRoles(
  claims: Record<string, unknown>,
  clientId?: string,
): string[] {
  if (!clientId) return [];
  const resourceAccess = claims['resource_access'] as Record<string, { roles?: unknown }> | undefined;
  const roles = resourceAccess?.[clientId]?.roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
}

export function detectServiceAccount(claims: Record<string, unknown>): boolean {
  if (typeof claims['client_id'] === 'string') return true;
  const username = claims['preferred_username'];
  return typeof username === 'string' && username.startsWith('service-account-');
}

export function extractRoles(claims: Record<string, unknown>): string[] {
  const realmAccess = claims['realm_access'] as { roles?: unknown } | undefined;
  const roles = realmAccess?.roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
}
