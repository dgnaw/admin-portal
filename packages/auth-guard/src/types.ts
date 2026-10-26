export type Role = 'Sysadmin' | 'Tenant_Admin' | 'Tenant_User';

export interface OrganizationContext {
  alias: string;
  id?: string;
  compositeTenantId: string;
  productCode?: string;
  tenantCode?: string;
  isRootTenant: boolean;
}

export interface TenantPrincipal {
  realm: string;
  org: OrganizationContext | null;
  sub: string;
  username?: string;
  email?: string;
  roles: string[];
  clientRoles: string[];
  clientId?: string;
  isServiceAccount: boolean;
  tenantId: string | null;
  compositeUserId: string | null;
  claims: Record<string, unknown>;
}

export interface AuthGuardConfig {
  issuers: string[];
  audience?: string | string[];
  clockToleranceSec?: number;
  jwksCacheMaxAgeMs?: number;
  jwksCooldownMs?: number;
  separator?: string;
  aliasPattern?: RegExp;
  allowDerivedTenantId?: boolean;
}

export type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'UNKNOWN_ISSUER'
  | 'INVALID_SIGNATURE'
  | 'TOKEN_EXPIRED'
  | 'INVALID_AUDIENCE'
  | 'NO_ORGANIZATION'
  | 'AMBIGUOUS_ORGANIZATION'
  | 'INVALID_ALIAS'
  | 'TENANT_ID_MISSING'
  | 'TENANT_ID_MISMATCH'
  | 'FORBIDDEN_ROLE'
  | 'SERVICE_TOKEN_NOT_ALLOWED'
  | 'MISSING_ORIGIN_ACTOR'
  | 'TOKEN_REQUEST_FAILED';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, status: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}
