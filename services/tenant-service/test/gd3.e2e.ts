import assert from 'node:assert/strict';

const KC = 'http://localhost:8080';
const TENANT = 'http://localhost:3101';
const AUDIT = 'http://localhost:3102';

async function sysadminToken() {
  const res = await fetch(`${KC}/realms/Platform/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-portal', username: 'sysadmin.platform', password: 'Sys@12345',
      grant_type: 'password', scope: 'openid',
    }),
  });
  const b = (await res.json()) as any;
  assert.ok(b.access_token, JSON.stringify(b));
  return b.access_token as string;
}

async function tenantAdminToken() {
  const res = await fetch(`${KC}/realms/Blegal/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-portal', username: 'dgnaw', password: 'Test@12345',
      grant_type: 'password', scope: 'openid organization',
    }),
  });
  const b = (await res.json()) as any;
  assert.ok(b.access_token, JSON.stringify(b));
  return b.access_token as string;
}

const results: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push(`  PASS  ${name}`); }
  catch (err) { results.push(`  FAIL  ${name}\n        ${(err as Error).message}`); process.exitCode = 1; }
}

const json = (t: string, body?: unknown, method = 'GET') => ({
  method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString().slice(-6);

async function main() {
  const sys = await sysadminToken();
  const admin = await tenantAdminToken();

  await test('khai bao San pham -> tu tao Tenant goc', async () => {
    const r = await fetch(`${TENANT}/products`, json(sys, { code: 'Blegal', name: 'BLegal', realm: 'Blegal' }, 'POST'));
    assert.equal(r.status, 201, `HTTP ${r.status}`);
    const rows = await (await fetch(`${TENANT}/tenants?productCode=Blegal`, json(sys))).json() as any[];
    const root = rows.find((t) => t.is_root);
    assert.ok(root, 'khong co Tenant goc');
    assert.equal(root.composite_tenant_id, 'Blegal_Default');
  });

  let created: any;
  await test('tao Tenant: sinh composite id + gan CNAME', async () => {
    const r = await fetch(`${TENANT}/tenants`, json(sys, {
      productCode: 'Blegal', name: `Cty ${stamp}`, cname: `t${stamp}.example.com`,
    }, 'POST'));
    const text = await r.text();
    assert.equal(r.status, 201, text);
    created = JSON.parse(text);
    assert.equal(created.composite_tenant_id, `Blegal_Cty${stamp}`);
    assert.equal(created.product_code, 'Blegal');
  });

  await test('ma Tenant trung -> 409', async () => {
    const r = await fetch(`${TENANT}/tenants`, json(sys, {
      productCode: 'Blegal', name: 'x', tenantCode: created.tenant_code,
    }, 'POST'));
    assert.equal(r.status, 409, `nhan ${r.status}`);
  });

  await test('ma Tenant chua dau gach duoi -> 400', async () => {
    const r = await fetch(`${TENANT}/tenants`, json(sys, {
      productCode: 'Blegal', name: 'x', tenantCode: 'FPT_01',
    }, 'POST'));
    assert.equal(r.status, 400, `nhan ${r.status}`);
  });

  await test('CNAME trung Tenant khac -> 409 (CONS-05)', async () => {
    const r = await fetch(`${TENANT}/tenants`, json(sys, {
      productCode: 'Blegal', name: `Khac ${stamp}`, cname: `t${stamp}.example.com`,
    }, 'POST'));
    assert.equal(r.status, 409, `nhan ${r.status}`);
  });

  await test('Tenant goc thu hai cung San pham bi chan', async () => {
    const r = await fetch(`${TENANT}/tenants`, json(sys, {
      productCode: 'Blegal', name: `Root2 ${stamp}`, isRoot: true,
    }, 'POST'));
    assert.ok(r.status >= 400, `mong doi loi, nhan ${r.status}`);
  });

  await test('phan giai CNAME tra ve San pham + Tenant + whitelabel', async () => {
    await fetch(`${TENANT}/tenants/${created.composite_tenant_id}/oidc`, json(sys, {
      issuerUrl: 'http://localhost:8080/realms/Blegal', clientId: 'admin-portal',
    }, 'PUT'));
    await fetch(`${TENANT}/tenants/${created.composite_tenant_id}/whitelabel/librechat`, json(sys, {
      logo: 'https://x/logo.png', brandColor: '#0a0',
    }, 'PUT'));
    const r = await fetch(`${TENANT}/resolve?host=t${stamp}.example.com`);
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const d = JSON.parse(text) as any;
    assert.equal(d.composite_tenant_id, created.composite_tenant_id);
    assert.equal(d.product_code, 'Blegal');
    assert.equal(d.issuer_url, 'http://localhost:8080/realms/Blegal');
    assert.equal(d.whitelabel.librechat.brandColor, '#0a0');
  });

  await test('CNAME chua cau hinh -> 404', async () => {
    const r = await fetch(`${TENANT}/resolve?host=khong-ton-tai.example.com`);
    assert.equal(r.status, 404);
  });

  await test('Tenant Admin khong doc duoc Tenant cua to chuc khac', async () => {
    const r = await fetch(`${TENANT}/tenants/${created.composite_tenant_id}`, json(admin));
    assert.equal(r.status, 403, `nhan ${r.status}`);
  });

  await test('Tenant Admin doc duoc dung Tenant cua minh', async () => {
    const r = await fetch(`${TENANT}/tenants/Blegal_Vinasa`, json(admin));
    assert.equal(r.status, 404, `Blegal_Vinasa chua co trong Tenant Service, nhan ${r.status}`);
  });

  await test('Tenant Admin khong tao duoc Tenant (chi Sysadmin)', async () => {
    const r = await fetch(`${TENANT}/tenants`, json(admin, { productCode: 'Blegal', name: 'hack' }, 'POST'));
    assert.equal(r.status, 403, `nhan ${r.status}`);
  });

  await test('su kien audit chay qua Kafka vao Audit Log Service', async () => {
    let rows: any[] = [];
    for (let i = 0; i < 20 && !rows.length; i++) {
      await sleep(500);
      const r = await fetch(`${AUDIT}/audit?tenantId=${created.composite_tenant_id}`, json(sys));
      rows = await r.json() as any[];
    }
    assert.ok(rows.length, 'khong nhan duoc su kien audit nao');
    const types = rows.map((r) => r.event_type);
    assert.ok(types.includes('tenant.created'), `thieu tenant.created, co: ${types.join(', ')}`);
    assert.ok(types.includes('tenant.oidc.updated'), `thieu tenant.oidc.updated`);
    const ev = rows.find((r) => r.event_type === 'tenant.created');
    assert.equal(ev.product_code, 'Blegal');
    assert.equal(ev.actor_type, 'user');
    assert.ok(ev.actor_id, 'thieu actor');
    results.push(`        (${rows.length} su kien, types: ${[...new Set(types)].join(', ')})`);
  });

  console.log(results.join('\n'));
}

main();
