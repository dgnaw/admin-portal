import { AuthError, type AuthGuardConfig, type TenantPrincipal } from './types';
import { createVerifier, requireRoles, requireTenant, type Verifier } from './verifier';
import { assertUserFlow } from './relay';

export interface GuardOptions {
  requireTenant?: boolean;
  roles?: string[];
  principalKey?: string;
  allowServiceToken?: boolean;
}

export function bearerFrom(headers: Record<string, unknown>): string {
  const raw = headers['authorization'] ?? headers['Authorization'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    throw new AuthError('MISSING_TOKEN', 401, 'Thieu header Authorization');
  }
  const [scheme, token] = value.split(' ');
  if (!/^Bearer$/i.test(scheme ?? '') || !token) {
    throw new AuthError('MISSING_TOKEN', 401, 'Header Authorization phai co dang "Bearer <token>"');
  }
  return token;
}

export async function authenticate(
  verifier: Verifier,
  headers: Record<string, unknown>,
  options: GuardOptions = {},
): Promise<TenantPrincipal> {
  const principal = await verifier.verify(bearerFrom(headers));
  if (options.allowServiceToken === false) assertUserFlow(principal);
  if (options.requireTenant !== false) requireTenant(principal);
  if (options.roles?.length) requireRoles(principal, options.roles);
  return principal;
}

export function createExpressGuard(
  config: AuthGuardConfig | Verifier,
  options: GuardOptions = {},
) {
  const verifier = 'verify' in config ? config : createVerifier(config);
  const key = options.principalKey ?? 'tenant';

  return async function tenantGuard(req: any, res: any, next: any): Promise<void> {
    try {
      req[key] = await authenticate(verifier, req.headers ?? {}, options);
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  };
}
