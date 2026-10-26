import assert from 'node:assert/strict';
import {
  AuthError,
  auditActor,
  createRelay,
  createServiceTokenProvider,
  createVerifier,
  relayHeaders,
} from '../src/index';

const KC = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALMS = ['Platform', 'Blegal', 'AIHub', 'LDM'];
const ISSUERS = REALMS.map((r) => `${KC}/realms/${r}`);

async function userToken(realm: string, username: string, password: string) {
  const res = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-portal', username, password,
      grant_type: 'password', scope: 'openid organization',
    }),
  });
  const body = (await res.json()) as any;
  assert.ok(body.access_token, JSON.stringify(body));
  return body.access_token as string;
}

const results: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push(`  PASS  ${name}`);
  } catch (err) {
    results.push(`  FAIL  ${name}\n        ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function expectAuthError(code: string, fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof AuthError, `mong doi AuthError, nhan ${err}`);
    assert.equal(err.code, code, `mong doi ${code}, nhan ${err.code}`);
    return err;
  }
  throw new Error(`mong doi AuthError ${code} nhung khong co loi nao`);
}

async function main() {
  const verifier = createVerifier({ issuers: ISSUERS });
  const provider = createServiceTokenProvider({
    issuers: ISSUERS,
    clientId: 'platform-service',
    clientSecret: 'platform-service-secret',
  });

  await test('lay duoc service token cho tung realm', async () => {
    for (const realm of REALMS) {
      const p = await verifier.verify(await provider.getToken(realm));
      assert.equal(p.realm, realm);
      assert.equal(p.isServiceAccount, true);
      assert.equal(p.clientId, 'platform-service');
      assert.ok(p.clientRoles.includes('platform-admin'), `thieu client role o ${realm}`);
      assert.equal(p.tenantId, null);
    }
  });

  await test('token duoc cache: lan thu hai khong goi mang', async () => {
    const t0 = Date.now(); await provider.getToken('Blegal'); const warm = Date.now() - t0;
    assert.ok(warm < 5, `warm=${warm}ms, co ve van goi mang`);
  });

  await test('cache tra ve dung mot token, invalidate thi doi token moi', async () => {
    const a = await provider.getToken('Blegal');
    const b = await provider.getToken('Blegal');
    assert.equal(a, b);
    provider.invalidate('Blegal');
    const c = await provider.getToken('Blegal');
    assert.ok(typeof c === 'string' && c.length > 0);
  });

  await test('goi song song chi phat sinh mot lan lay token (coalescing)', async () => {
    let calls = 0;
    const counting = createServiceTokenProvider({
      issuers: ISSUERS, clientId: 'platform-service', clientSecret: 'platform-service-secret',
      fetchImpl: ((...args: Parameters<typeof fetch>) => { calls++; return fetch(...args); }) as typeof fetch,
    });
    await Promise.all(Array.from({ length: 10 }, () => counting.getToken('Blegal')));
    assert.equal(calls, 1, `goi ${calls} lan thay vi 1`);
  });

  await test('secret sai -> TOKEN_REQUEST_FAILED (502)', async () => {
    const bad = createServiceTokenProvider({
      issuers: ISSUERS, clientId: 'platform-service', clientSecret: 'sai-secret',
    });
    const err = await expectAuthError('TOKEN_REQUEST_FAILED', () => bad.getToken('Blegal'));
    assert.equal((err as AuthError).status, 502);
  });

  await test('realm ngoai cau hinh -> UNKNOWN_ISSUER', async () => {
    await expectAuthError('UNKNOWN_ISSUER', () => provider.getToken('KhongTonTai'));
  });

  await test('client role dung duoc cho requireRoles', async () => {
    const { requireRoles } = await import('../src/verifier');
    const p = await verifier.verify(await provider.getToken('Blegal'));
    requireRoles(p, ['platform-admin']);
    assert.throws(() => requireRoles(p, ['Sysadmin']), /FORBIDDEN|role/i);
  });

  await test('Token Relay: chuyen tiep nguyen ven token nguoi dung', async () => {
    const raw = await userToken('Blegal', 'dgnaw', 'Test@12345');
    const p = await verifier.verify(raw);
    const headers = relayHeaders({ authorization: `Bearer ${raw}` }, p);
    assert.equal(headers.Authorization, `Bearer ${raw}`);
  });

  await test('CAM danh trao: service token khong duoc dung cho luong user', async () => {
    const raw = await provider.getToken('Blegal');
    const p = await verifier.verify(raw);
    const err = await expectAuthError('SERVICE_TOKEN_NOT_ALLOWED', () =>
      relayHeaders({ authorization: `Bearer ${raw}` }, p),
    );
    assert.equal((err as AuthError).status, 403);
  });

  await test('createRelay doc principal tu req', async () => {
    const raw = await userToken('Blegal', 'dgnaw', 'Test@12345');
    const p = await verifier.verify(raw);
    const relay = createRelay();
    const headers = relay({ headers: { authorization: `Bearer ${raw}` }, tenant: p }, { 'X-Req-Id': 'abc' });
    assert.equal(headers.Authorization, `Bearer ${raw}`);
    assert.equal(headers['X-Req-Id'], 'abc');
  });

  await test('audit actor: luong user ghi chinh nguoi do', async () => {
    const p = await verifier.verify(await userToken('Blegal', 'dgnaw', 'Test@12345'));
    const a = auditActor(p);
    assert.equal(a.actorType, 'user');
    assert.equal(a.actorId, p.sub);
    assert.equal(a.tenantId, 'Blegal_Vinasa');
  });

  await test('audit actor: luong he thong BAT BUOC co actor goc', async () => {
    const p = await verifier.verify(await provider.getToken('Blegal'));
    await expectAuthError('MISSING_ORIGIN_ACTOR', () => auditActor(p));
    const a = auditActor(p, 'user-972ff7d0');
    assert.equal(a.actorType, 'service');
    assert.equal(a.actorId, 'user-972ff7d0');
    assert.equal(a.onBehalfOf, 'platform-service');
  });

  console.log(results.join('\n'));
}

main();
