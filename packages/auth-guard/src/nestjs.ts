import { type AuthGuardConfig } from './types';
import { createVerifier, type Verifier } from './verifier';
import { authenticate, type GuardOptions } from './express';

export function createNestGuard(config: AuthGuardConfig | Verifier, options: GuardOptions = {}) {
  const verifier = 'verify' in config ? config : createVerifier(config);
  const key = options.principalKey ?? 'tenant';

  return class TenantAuthGuard {
    async canActivate(context: any): Promise<boolean> {
      const req = context.switchToHttp().getRequest();
      req[key] = await authenticate(verifier, req.headers ?? {}, options);
      return true;
    }
  };
}

export function createAuthExceptionFilter() {
  return class AuthExceptionFilter {
    catch(exception: any, host: any) {
      const res = host.switchToHttp().getResponse();
      if (exception?.name === 'AuthError') {
        res.status(exception.status).json({ error: exception.code, message: exception.message });
        return;
      }
      const status = exception?.status ?? exception?.getStatus?.() ?? 500;
      if (status >= 500) {
        console.error('[AuthExceptionFilter] loi khong mong doi:', exception);
      }
      const body = exception?.response ?? exception?.getResponse?.() ?? { message: 'Internal server error' };
      res.status(status).json(typeof body === 'string' ? { message: body } : body);
    }
  };
}
