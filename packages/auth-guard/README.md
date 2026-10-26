# @platform/auth-guard

Thu vien xac thuc JWT da Realm dung chung cho Admin Portal, Tenant Service,
Orchestrator, LibreChat va LDM. Khong co API Gateway trung tam nen moi service
tu verify token tai cho (ADR-9, ADR-28).

## Dinh dang dinh danh

Composite Tenant ID do Tenant Service sinh va **duoc doc tu claim**, thu vien
khong tu ghep (ADR-14: cam service tu che bien quy tac ghep rieng).

```json
"organization": {
  "Vinasa": {
    "id": "15bd4fcb-...",
    "product_code": ["Blegal"],
    "tenant_code": ["Vinasa"],
    "composite_tenant_id": ["Blegal_Vinasa"],
    "is_root_tenant": ["false"]
  }
}
```

```
tenantId        = "Blegal_Vinasa"        <- doc tu claim
compositeUserId = "Blegal_Vinasa_<sub>"
```

Claim nay chi co khi organization mapper bat `addOrganizationAttributes` va
`addOrganizationId` (xem `infra/keycloak/bootstrap.py`). Thieu thuoc tinh thi
thu vien tra `TENANT_ID_MISSING`, **khong** am tham tu ghep.

Thu vien van kiem tra cheo: `composite_tenant_id` phai bang `<realm>_<alias>`
cua chinh token do, lech thi `TENANT_ID_MISMATCH`. Rang buoc: alias khop
`^[A-Za-z0-9]+$`, ten realm khong duoc chua `_`; `createVerifier` tu choi khoi
tao neu ten realm chua dau phan cach.

## Dung voi Express (LibreChat, LDM)

```ts
import { createExpressGuard } from '@platform/auth-guard/express';

const guard = createExpressGuard({ issuers: [
  'http://localhost:8080/realms/Blegal',
  'http://localhost:8080/realms/AIHub',
]});

app.use('/api', guard);
app.get('/api/me', (req, res) => res.json(req.tenant));
```

## Dung voi NestJS (Tenant Service, Orchestrator)

```ts
import { createNestGuard } from '@platform/auth-guard/nestjs';

const SysadminGuard = createNestGuard(
  { issuers: [...] },
  { requireTenant: false, roles: ['Sysadmin'] },
);

@UseGuards(SysadminGuard)
@Post('tenants')
createTenant() {}
```

## Luong he thong (Client Credentials)

```ts
import { createServiceTokenProvider, systemHeaders } from '@platform/auth-guard';

const provider = createServiceTokenProvider({
  issuers: [...],
  clientId: 'platform-service',
  clientSecret: process.env.PLATFORM_SERVICE_SECRET!,
});

await fetch(url, { headers: await provider.authHeader('Blegal') });
```

Token duoc cache theo realm va lam moi truoc khi het han (`refreshSkewSec`, mac
dinh 30s). Nhieu lenh goi song song cung mot realm chi phat sinh dung mot lan lay
token — cung ky thuat gop request nhu ADR-17.

Dung cho: buoc saga cua Orchestrator, consumer Kafka, tac vu nen, va moi loi goi
Keycloak Admin API. Client phai lay credential trong dung realm can thao tac.

## Token Relay

```ts
import { createRelay, auditActor } from '@platform/auth-guard';

const relay = createRelay();
await fetch(tenantServiceUrl, { headers: relay(req) });
```

`relay()` nem `SERVICE_TOKEN_NOT_ALLOWED` neu principal la service account —
ADR-28 cam thay token nguoi dung bang token he thong de muon quyen cao hon.
Chan luon tu tang guard thi dat `allowServiceToken: false`.

`auditActor()` dung cho su kien audit: luong user ghi chinh nguoi do; luong he
thong **bat buoc** truyen actor goc, khong truyen thi nem `MISSING_ORIGIN_ACTOR`
thay vi am tham ghi actor la service (ADR-8).

## Tuy chon Guard

| Tuy chon | Mac dinh | Y nghia |
|---|---|---|
| `requireTenant` | `true` | `false` cho service tang nen tang, vi Sysadmin khong thuoc org nao |
| `roles` | `[]` | Can it nhat mot role trong danh sach |
| `principalKey` | `'tenant'` | Ten thuoc tinh gan vao `req` |
| `allowServiceToken` | `true` | `false` thi tu choi service token ngay tai guard |

Tuy chon cua `createVerifier`:

| Tuy chon | Mac dinh | Y nghia |
|---|---|---|
| `audience` | khong kiem | ADR-28 yeu cau kiem; dat `'admin-portal'` sau khi co audience mapper |
| `allowDerivedTenantId` | `false` | `true` cho phep ghep `<realm>_<alias>` khi claim thieu thuoc tinh (duong lui khi di chuyen) |

**Sysadmin bat buoc dung `requireTenant: false`.** Token cua Sysadmin o realm
Platform khong co claim `organization`, nen `tenantId` se la `null`. Pham vi
tenant cua thao tac do lay tu tham so request va doi chieu voi role, khong lay
tu token.

## Ma loi

| Code | HTTP | Khi nao |
|---|---|---|
| `MISSING_TOKEN` | 401 | Thieu header `Authorization: Bearer ...` |
| `MALFORMED_TOKEN` | 401 | Khong phai JWT |
| `UNKNOWN_ISSUER` | 401 | `iss` khong nam trong whitelist |
| `INVALID_SIGNATURE` | 401 | Chu ky sai hoac khoa khong khop |
| `TOKEN_EXPIRED` | 401 | Qua `exp` |
| `INVALID_AUDIENCE` | 401 | Sai `aud` (chi khi co cau hinh `audience`) |
| `NO_ORGANIZATION` | 403 | `requireTenant` bat nhung token khong co org |
| `AMBIGUOUS_ORGANIZATION` | 400 | Token thuoc nhieu org cung luc |
| `TENANT_ID_MISSING` | 403 | Claim khong co `composite_tenant_id` |
| `TENANT_ID_MISMATCH` | 403 | `composite_tenant_id` lech realm/alias cua token |
| `SERVICE_TOKEN_NOT_ALLOWED` | 403 | Dung service token cho luong thay mat nguoi dung |
| `MISSING_ORIGIN_ACTOR` | 500 | Luong he thong ghi audit ma thieu actor goc |
| `TOKEN_REQUEST_FAILED` | 502 | Khong lay duoc service token tu Keycloak |
| `INVALID_ALIAS` | 400 | Alias sai dinh dang |
| `FORBIDDEN_ROLE` | 403 | Thieu role yeu cau |

## Luu y ve `audience`

Token Keycloak mac dinh chi co `aud = "account"`. `bootstrap.py` da them audience
mapper nen token hien ra `aud = ["admin-portal","account"]`, bat `audience` duoc.
Mac dinh thu vien van **khong** kiem tra `aud` de khong pha moi truong chua chay
lai bootstrap.

## Khong dung cho LibreChat / Flowise

ADR-28: *"Khong ap scheme verify tu viet len LibreChat va Flowise"*. Hai ung dung
do dung OIDC goc cua chinh no. Thu vien nay danh cho Admin Portal, Tenant Service,
Orchestrator, Audit Log Service va LDM.

## Test

```bash
npm run test:e2e
```

Chay ca hai bo: `verify.e2e.ts` (17 test) va `service-token.e2e.ts` (12 test).
Chay that vao Keycloak o `KEYCLOAK_URL` (mac dinh `http://localhost:8080`),
can da chay `infra/keycloak/bootstrap.py` truoc.
