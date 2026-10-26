import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { query, withTransaction } from './db';
import { EventBus, type ActorContext } from './events';
import { assertTenantCode, compositeTenantId, suggestTenantCode } from './tenant-code';
import { config } from './config';

export interface CreateTenantInput {
  productCode: string;
  name: string;
  tenantCode?: string;
  isRoot?: boolean;
  cname?: string;
}

export interface TenantRow {
  id: string;
  product_code: string;
  tenant_code: string;
  composite_tenant_id: string;
  name: string;
  is_root: boolean;
  status: string;
  keycloak_org_id: string | null;
}

@Injectable()
export class TenantService {
  constructor(@Inject(EventBus) private readonly events: EventBus) {}

  async listProducts() {
    return query('SELECT code, name, realm FROM products ORDER BY code');
  }

  async ensureProduct(code: string, name: string, realm: string, actor: ActorContext) {
    assertTenantCode(code);
    const existing = await query('SELECT code FROM products WHERE code = $1', [code]);
    if (existing.length) return { created: false, code };

    const tenant = await withTransaction(async (q) => {
      await q('INSERT INTO products (code, name, realm) VALUES ($1, $2, $3)', [code, name, realm]);
      const composite = compositeTenantId(code, 'Default', config.separator);
      const rows = await q<TenantRow>(
        `INSERT INTO tenants (product_code, tenant_code, composite_tenant_id, name, is_root)
         VALUES ($1, 'Default', $2, $3, true) RETURNING *`,
        [code, composite, `${name} Root Tenant`],
      );
      return rows[0];
    });

    await this.events.audit(tenant.composite_tenant_id, actor, 'product.created', { code, realm });
    return { created: true, code, rootTenant: tenant.composite_tenant_id };
  }

  async create(input: CreateTenantInput, actor: ActorContext): Promise<TenantRow> {
    const product = await query('SELECT code FROM products WHERE code = $1', [input.productCode]);
    if (!product.length) {
      throw new BadRequestException(`San pham "${input.productCode}" chua duoc khai bao`);
    }

    const explicit = input.tenantCode != null;
    let tenant: TenantRow | null = null;

    for (let attempt = 0; attempt < 20 && !tenant; attempt++) {
      const code = explicit ? input.tenantCode! : suggestTenantCode(input.name, attempt);
      assertTenantCode(code);
      const composite = compositeTenantId(input.productCode, code, config.separator);
      try {
        tenant = await withTransaction(async (q) => {
          const rows = await q<TenantRow>(
            `INSERT INTO tenants (product_code, tenant_code, composite_tenant_id, name, is_root)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [input.productCode, code, composite, input.name, input.isRoot ?? false],
          );
          if (input.cname) {
            await q('INSERT INTO cnames (hostname, tenant_id, kind) VALUES ($1, $2, $3)', [
              input.cname.toLowerCase(),
              rows[0].id,
              input.isRoot ? 'root' : 'organization',
            ]);
          }
          return rows[0];
        });
      } catch (err: any) {
        if (err?.code !== '23505') throw err;
        if (err.constraint === 'cnames_pkey') {
          throw new ConflictException(`CNAME "${input.cname}" da duoc dung boi Tenant khac (CONS-05)`);
        }
        if (explicit) {
          throw new ConflictException(`Ma Tenant "${code}" da ton tai trong San pham ${input.productCode}`);
        }
      }
    }

    if (!tenant) throw new ConflictException('Khong sinh duoc ma Tenant duy nhat sau 20 lan thu');

    await this.events.audit(tenant.composite_tenant_id, actor, 'tenant.created', {
      productCode: tenant.product_code,
      tenantCode: tenant.tenant_code,
      cname: input.cname ?? null,
    });
    await this.events.configUpdated(tenant.composite_tenant_id, actor, { reason: 'created' });
    return tenant;
  }

  async get(compositeTenantId: string): Promise<TenantRow> {
    const rows = await query<TenantRow>('SELECT * FROM tenants WHERE composite_tenant_id = $1', [
      compositeTenantId,
    ]);
    if (!rows.length) throw new NotFoundException(`Khong tim thay Tenant ${compositeTenantId}`);
    return rows[0];
  }

  async list(productCode?: string) {
    return productCode
      ? query<TenantRow>('SELECT * FROM tenants WHERE product_code = $1 ORDER BY tenant_code', [productCode])
      : query<TenantRow>('SELECT * FROM tenants ORDER BY product_code, tenant_code');
  }

  async setCname(compositeTenantId: string, hostname: string, actor: ActorContext) {
    const tenant = await this.get(compositeTenantId);
    const host = hostname.toLowerCase();
    try {
      await query(
        `INSERT INTO cnames (hostname, tenant_id, kind) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET hostname = EXCLUDED.hostname`,
        [host, tenant.id, tenant.is_root ? 'root' : 'organization'],
      );
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(`CNAME "${host}" da duoc dung boi Tenant khac (CONS-05)`);
      }
      throw err;
    }
    await this.events.audit(compositeTenantId, actor, 'tenant.cname.updated', { hostname: host });
    await this.events.configUpdated(compositeTenantId, actor, { reason: 'cname', hostname: host });
    return { hostname: host };
  }

  async setOidc(compositeTenantId: string, body: Record<string, any>, actor: ActorContext) {
    const tenant = await this.get(compositeTenantId);
    await query(
      `INSERT INTO oidc_configs (tenant_id, issuer_url, client_id, client_secret, well_known_url, use_pkce)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         issuer_url = EXCLUDED.issuer_url, client_id = EXCLUDED.client_id,
         client_secret = EXCLUDED.client_secret, well_known_url = EXCLUDED.well_known_url,
         use_pkce = EXCLUDED.use_pkce, updated_at = now()`,
      [tenant.id, body.issuerUrl, body.clientId, body.clientSecret ?? null,
       body.wellKnownUrl ?? null, body.usePkce ?? true],
    );
    await this.events.audit(compositeTenantId, actor, 'tenant.oidc.updated', { issuerUrl: body.issuerUrl });
    await this.events.configUpdated(compositeTenantId, actor, { reason: 'oidc' });
    return { ok: true };
  }

  async setWhitelabel(compositeTenantId: string, appCode: string, cfg: Record<string, unknown>, actor: ActorContext) {
    const tenant = await this.get(compositeTenantId);
    await query(
      `INSERT INTO whitelabel (tenant_id, app_code, config) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, app_code) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
      [tenant.id, appCode, JSON.stringify(cfg)],
    );
    await this.events.audit(compositeTenantId, actor, 'tenant.whitelabel.updated', { appCode });
    await this.events.configUpdated(compositeTenantId, actor, { reason: 'whitelabel', appCode });
    return { ok: true };
  }

  async resolveByHost(hostname: string) {
    const rows = await query(
      `SELECT t.composite_tenant_id, t.product_code, t.tenant_code, t.name, t.is_root, t.status,
              c.hostname, c.kind,
              o.issuer_url, o.client_id, o.well_known_url, o.use_pkce,
              COALESCE(jsonb_object_agg(w.app_code, w.config) FILTER (WHERE w.app_code IS NOT NULL), '{}'::jsonb) AS whitelabel
         FROM cnames c
         JOIN tenants t ON t.id = c.tenant_id
         LEFT JOIN oidc_configs o ON o.tenant_id = t.id
         LEFT JOIN whitelabel w ON w.tenant_id = t.id
        WHERE c.hostname = $1
        GROUP BY t.composite_tenant_id, t.product_code, t.tenant_code, t.name, t.is_root, t.status,
                 c.hostname, c.kind, o.issuer_url, o.client_id, o.well_known_url, o.use_pkce`,
      [hostname.toLowerCase()],
    );
    if (!rows.length) throw new NotFoundException(`CNAME "${hostname}" chua duoc cau hinh`);
    return rows[0];
  }
}
