CREATE TABLE IF NOT EXISTS products (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  realm       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_code_charset CHECK (code ~ '^[A-Za-z0-9]+$')
);

CREATE TABLE IF NOT EXISTS tenants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code        TEXT NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
  tenant_code         TEXT NOT NULL,
  composite_tenant_id TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  is_root             BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'active',
  keycloak_org_id     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_code_charset CHECK (tenant_code ~ '^[A-Za-z0-9]+$'),
  CONSTRAINT tenants_status_valid CHECK (status IN ('active', 'suspended')),
  CONSTRAINT tenants_composite_shape CHECK (composite_tenant_id = product_code || '_' || tenant_code),
  CONSTRAINT tenants_product_code_unique UNIQUE (product_code, tenant_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_root_per_product
  ON tenants (product_code) WHERE is_root;

CREATE TABLE IF NOT EXISTS cnames (
  hostname    TEXT PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cnames_kind_valid CHECK (kind IN ('root', 'organization')),
  CONSTRAINT cnames_hostname_lower CHECK (hostname = lower(hostname))
);

CREATE UNIQUE INDEX IF NOT EXISTS cnames_one_per_tenant ON cnames (tenant_id);

CREATE TABLE IF NOT EXISTS oidc_configs (
  tenant_id       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  issuer_url      TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  client_secret   TEXT,
  well_known_url  TEXT,
  use_pkce        BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whitelabel (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_code    TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, app_code)
);
