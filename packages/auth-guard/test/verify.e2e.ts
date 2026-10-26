import assert from 'node:assert/strict';
import { AuthError, createVerifier, parseTenantId, resolveOrganization } from '../src/index';

const KC = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALMS = ['Platform', 'Blegal', 'AIHub', 'LDM'];
const ISSUERS = REALMS.map((r) => `${KC}/realms/${r}`);

async function token(realm: string, username: string, password: string, scope = 'openid organization') {
  const res = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-portal', username, password, grant_type: 'password', scope,
    }),
  });
  const body = (await res.json()) as any;
  assert.ok(body.access_token, `khong lay duoc token ${realm}/${username}: ${JSON.stringify(body)}`);
  return body.access_token as string;
}

async function serviceToken(realm: string) {
  const res = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'platform-service', client_secret: 'platform-service-secret',
      grant_type: 'client_credentials',
    }),
  });
  const body = (await res.json()) as any;
  assert.ok(body.access_token, `khong lay duoc service token ${realm}: ${JSON.stringify(body)}`);
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
    assert.ok(err instanceof AuthError, `mong doi AuthError, nhan duoc ${err}`);
    assert.equal(err.code, code, `mong doi ${code}, nhan ${err.code}`);
    return err;
  }
  throw new Error(`mong doi AuthError ${code} nhung khong co loi nao`);
}

async function main() {
  const verifier = createVerifier({ issuers: ISSUERS });

  await test('composite_tenant_id DOC tu claim, khong tu ghep', async () => {
    const p = await verifier.verify(await token('Blegal', 'dgnaw', 'Test@12345'));
    assert.equal(p.realm, 'Blegal');
    assert.equal(p.org?.alias, 'Vinasa');
    assert.equal(p.tenantId, 'Blegal_Vinasa');
    assert.equal(p.org?.productCode, 'Blegal');
    assert.equal(p.org?.tenantCode, 'Vinasa');
    assert.ok(p.org?.id, 'thieu organization id trong claim');
    assert.equal(p.org?.isRootTenant, false);
    assert.equal(p.compositeUserId, `Blegal_Vinasa_${p.sub}`);
    assert.ok(p.roles.includes('Tenant_Admin'));
  });

  await test('thieu composite_tenant_id -> TENANT_ID_MISSING (khong am tham tu ghep)', async () => {
    await expectAuthError('TENANT_ID_MISSING', () =>
      resolveOrganization(['Vinasa'], { realm: 'Blegal' }),
    );
  });

  await test('allowDerivedTenantId bat -> van ghep duoc (duong lui)', async () => {
    const org = resolveOrganization(['Vinasa'], { realm: 'Blegal', allowDerivedTenantId: true });
    assert.equal(org?.compositeTenantId, 'Blegal_Vinasa');
  });

  await test('composite_tenant_id lech realm/alias -> TENANT_ID_MISMATCH', async () => {
    await expectAuthError('TENANT_ID_MISMATCH', () =>
      resolveOrganization({ Vinasa: { composite_tenant_id: ['AIHub_Acme'] } }, { realm: 'Blegal' }),
    );
  });

  await test('Tenant goc nhan dien duoc qua is_root_tenant', async () => {
    const org = resolveOrganization(
      { Default: { composite_tenant_id: ['Blegal_Default'], is_root_tenant: ['true'] } },
      { realm: 'Blegal' },
    );
    assert.equal(org?.isRootTenant, true);
    assert.equal(org?.compositeTenantId, 'Blegal_Default');
  });

  await test('parseTenantId dao nguoc duoc composite id', async () => {
    assert.deepEqual(parseTenantId('Blegal_Vinasa'), { realm: 'Blegal', orgAlias: 'Vinasa' });
  });

  await test('sysadmin realm Platform -> khong co org, tenantId null', async () => {
    const p = await verifier.verify(await token('Platform', 'sysadmin.platform', 'Sys@12345'));
    assert.equal(p.org, null);
    assert.equal(p.tenantId, null);
    assert.ok(p.roles.includes('Sysadmin'));
  });

  await test('Client Credentials: service token verify duoc, khong co tenant', async () => {
    const p = await verifier.verify(await serviceToken('Blegal'));
    assert.equal(p.org, null);
    assert.equal(p.tenantId, null);
    assert.ok(p.claims['clientId'] === 'platform-service' || p.sub.length > 0);
  });

  await test('audience admin-portal duoc chap nhan (ADR-28)', async () => {
    const v = createVerifier({ issuers: ISSUERS, audience: 'admin-portal' });
    const p = await v.verify(await token('Blegal', 'dgnaw', 'Test@12345'));
    assert.equal(p.tenantId, 'Blegal_Vinasa');
  });

  await test('audience sai -> INVALID_AUDIENCE', async () => {
    const v = createVerifier({ issuers: ISSUERS, audience: 'khong-ton-tai' });
    const t = await token('Blegal', 'dgnaw', 'Test@12345');
    await expectAuthError('INVALID_AUDIENCE', () => v.verify(t));
  });

  await test('issuer ngoai whitelist bi tu choi', async () => {
    const narrow = createVerifier({ issuers: [`${KC}/realms/AIHub`] });
    const t = await token('Blegal', 'dgnaw', 'Test@12345');
    await expectAuthError('UNKNOWN_ISSUER', () => narrow.verify(t));
  });

  await test('token bi sua composite_tenant_id -> INVALID_SIGNATURE', async () => {
    const raw = await token('Blegal', 'dgnaw', 'Test@12345');
    const [h, p, s] = raw.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.organization = { Acme: { composite_tenant_id: ['Blegal_Acme'] } };
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    await expectAuthError('INVALID_SIGNATURE', () => verifier.verify(forged));
  });

  await test('chuoi rac -> MALFORMED_TOKEN', async () => {
    await expectAuthError('MALFORMED_TOKEN', () => verifier.verify('khong-phai-jwt'));
  });

  await test('nhieu organization -> AMBIGUOUS_ORGANIZATION (400)', async () => {
    const err = await expectAuthError('AMBIGUOUS_ORGANIZATION', () =>
      resolveOrganization({ Vinasa: {}, Acme: {} }, { realm: 'Blegal' }),
    );
    assert.equal((err as AuthError).status, 400);
  });

  await test('alias chua dau phan cach bi chan', async () => {
    await expectAuthError('INVALID_ALIAS', () =>
      resolveOrganization({ FPT_01: {} }, { realm: 'Blegal' }),
    );
  });

  await test('realm chua dau phan cach -> tu choi ngay luc khoi tao', async () => {
    assert.throws(() => createVerifier({ issuers: [`${KC}/realms/AI_Hub`] }), /dau phan cach/);
  });

  await test('JWKS duoc cache: lan verify thu hai khong goi mang', async () => {
    const v = createVerifier({ issuers: ISSUERS });
    const t = await token('Blegal', 'dgnaw', 'Test@12345');
    const t0 = Date.now(); await v.verify(t); const cold = Date.now() - t0;
    const t1 = Date.now(); await v.verify(t); const warm = Date.now() - t1;
    assert.ok(warm <= cold, `warm=${warm}ms cold=${cold}ms`);
    results.push(`        (cold=${cold}ms warm=${warm}ms)`);
  });

  const t = await token('Blegal', 'dgnaw', 'Test@12345');
  const claims = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
  results.push(`\n  aud = ${JSON.stringify(claims.aud)}`);
  results.push(`  organization = ${JSON.stringify(claims.organization)}`);

  console.log(results.join('\n'));
}

main();
