import { AuthError } from './types';
import { realmFromIssuer } from './tenant';

export interface ServiceClientConfig {
  issuers: string[];
  clientId: string;
  clientSecret: string;
  refreshSkewSec?: number;
  fetchImpl?: typeof fetch;
}

export interface ServiceTokenProvider {
  getToken(realm: string): Promise<string>;
  authHeader(realm: string): Promise<Record<string, string>>;
  invalidate(realm?: string): void;
  realms(): string[];
}

interface CacheEntry {
  token: string;
  expiresAt: number;
  inflight?: Promise<string>;
}

export function createServiceTokenProvider(config: ServiceClientConfig): ServiceTokenProvider {
  if (!config.issuers?.length) {
    throw new Error('auth-guard: can it nhat mot issuer cho service token provider');
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error('auth-guard: thieu clientId hoac clientSecret cho Client Credentials');
  }

  const skewMs = (config.refreshSkewSec ?? 30) * 1000;
  const doFetch = config.fetchImpl ?? fetch;
  const endpoints = new Map<string, string>();
  const cache = new Map<string, CacheEntry>();

  for (const raw of config.issuers) {
    const issuer = raw.replace(/\/+$/, '');
    endpoints.set(realmFromIssuer(issuer), `${issuer}/protocol/openid-connect/token`);
  }

  async function request(realm: string, url: string): Promise<string> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error_description?: string; error?: string }
      | null;

    if (!res.ok || !body?.access_token) {
      const reason = body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
      throw new AuthError(
        'TOKEN_REQUEST_FAILED',
        502,
        `Khong lay duoc service token cua realm ${realm}: ${reason}`,
      );
    }

    const ttlMs = (body.expires_in ?? 60) * 1000;
    cache.set(realm, { token: body.access_token, expiresAt: Date.now() + ttlMs - skewMs });
    return body.access_token;
  }

  async function getToken(realm: string): Promise<string> {
    const url = endpoints.get(realm);
    if (!url) {
      throw new AuthError('UNKNOWN_ISSUER', 500, `Realm ${realm} khong co trong cau hinh service client`);
    }

    const entry = cache.get(realm);
    if (entry && Date.now() < entry.expiresAt) return entry.token;
    if (entry?.inflight) return entry.inflight;

    const inflight = request(realm, url).finally(() => {
      const current = cache.get(realm);
      if (current) delete current.inflight;
    });
    cache.set(realm, { token: '', expiresAt: 0, ...cache.get(realm), inflight });
    return inflight;
  }

  return {
    getToken,
    async authHeader(realm: string) {
      return { Authorization: `Bearer ${await getToken(realm)}` };
    },
    invalidate(realm?: string) {
      if (realm) cache.delete(realm);
      else cache.clear();
    },
    realms: () => [...endpoints.keys()],
  };
}
