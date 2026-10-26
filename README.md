# Admin Portal — Multi-tenant

## Quyet dinh kien truc da chot

| Khoa | Gia tri | Ly do |
|---|---|---|
| `tenant_id` | `<realm>_<org_alias>` vd `Blegal_Vinasa` | Tenant Service sinh, day vao token qua org attribute; service **doc** chu khong ghep (ADR-14) |
| `composite_user_id` | `<realm>_<org_alias>_<sub>` | Dung lam `user_id` trong LibreChat / LDM |
| Dau phan cach | `_` theo doc goc; alias rang `^[A-Za-z0-9]+$`, realm cam chua `_` |
| Khoa tenant | **`alias`**, KHONG dung `name` | Keycloak chan doi `alias` (400 "Cannot change the alias"); `name` doi tu do |

## Hien trang

- [x] GD1.1 Keycloak: realm `Platform` / `Blegal` / `AIHub` / `LDM`, feature `organization`, 3 role
- [x] GD1.1 Client `admin-portal` (user) + `platform-service` (Client Credentials, ADR-28)
- [x] GD1.1 Audience mapper -> `aud` kiem duoc (ADR-28)
- [x] GD1.1 Tenant goc moi San pham: `Blegal_Default`, `AIHub_Default`, `LDM_Default`
- [x] GD1.1 Org `Vinasa` + user `dgnaw` sinh duoc JWT
- [x] GD1.2 Keycloak chay tren `pg-keycloak` (khong con H2, restart khong mat du lieu)
- [x] GD1.2 3 cum Postgres doc lap: `pg-keycloak` 5433 / `pg-librechat` 5434 / `pg-ldm` 5435 + `redis` 6379
- [~] RLS — **khong tich hop** theo quyet dinh 2026-10-20
- [x] GD2.1 Shared package `@platform/auth-guard` — 17/17 test e2e pass
- [x] GD2.1 Composite Tenant ID doc tu claim (duong A, ADR-14)
- [x] GD2.2 Client Credentials provider — cache theo realm + gop request, 12/12 test
- [x] GD2.2 Token Relay + chan danh trao token he thong (ADR-28)
- [x] GD2.2 Client role (`platform-admin`) + audience mapper cho `platform-service`
- [ ] GD2.3 Khung test chong ro ri cheo (chay that o GD4)
- [~] GD2.2 Bom RLS vao connection pool — **bo** (khong tich hop RLS)
- [x] GD3.1 Tenant Service (NestJS + `pg-tenant` 5436) — sinh Composite Tenant ID, CRUD, phan giai CNAME
- [x] GD3.2 Kafka (9092) + `@platform/events` — 4 topic, partition key = tenant_id
- [x] GD3.3 Audit Log Service (NestJS + `pg-audit` 5437) — append-only ep o tang DB
- [x] GD3 e2e 12/12 pass (Tenant Service -> Kafka -> Audit Log)
- [ ] GD4 LibreChat (fork) + LDM — **khong** gan auth-guard vao LibreChat (ADR-28)
- [ ] GD5 Orchestrator Saga + UI

## Pham vi da chot (2026-10-20)

- **Bo Flowise** khoi nen tang. San pham con lai: BLegal, AI Hub (tren LibreChat), LDM.
- **LibreChat la ban fork** cua team, khong phai ban goc.
- **Email unique: chon phuong an (a)** — doi unique index sang compound
  `(email, composite_tenant_id)` o ca LibreChat va LDM. Thuc hien o GD4.
  Ly do: LibreChat `schema/user.ts` co `email: unique` toan cuc va
  `socialLogin.js` tra user chi bang email; LDM `entities/User.ts` cung
  `email`/`username` unique toan cuc -> khong tao duoc 2 ban ghi User cho cung
  mot email o 2 San pham (ADR-14, CONS-03).
  **Ca hai DB con trong (xac nhan 2026-10-21)** -> khong can backfill, khong can
  giai doan migration rieng. Nhung neu team bat dau dung that truoc GD4 thi phai
  keo phan doi schema len lam som. Nho DROP index `email_1` cu trong MongoDB,
  sua schema trong code khong tu go rang buoc da ton tai trong DB.
- **LibreChat dung MongoDB + Mongoose** (fork v0.8.0-rc3, nhanh `develop-mst`)
  -> `pg-librechat` trong compose la THUA, can thay bang MongoDB.
  **Chot giu MongoDB cho LibreChat (2026-10-21).** Da can nhac doi sang Postgres
  nhung loai: viet lai tang du lieu (163 file mongoose, 76 schema, 31 collection)
  vi pham NFR-CONS-07 va giet duong nang base; con FerretDB/DocumentDB thi khong
  vi pham kien truc nhung can extension rieng, khong dung lai duoc cum Postgres
  san co, va chua co case study production doc lap. Engine khong anh huong phan
  multi-tenant.
- **LDM dung PostgreSQL 16 + TypeORM** -> `pg-ldm` dung.
- Khong tich hop RLS — khop voi ADR-13 (row per tenant + kiem tra tang ung dung
  + kiem thu tu dong do truy van thieu dieu kien tenant).

## Chay

```bash
docker compose up -d
python3 infra/keycloak/bootstrap.py       # idempotent, chay lai bao nhieu lan cung duoc
```

Sua `infra/keycloak/realms.json` roi chay lai bootstrap de them realm / org / user.
Luu y: bootstrap khong reset password cua user da ton tai.

## Chay service

```bash
cd services/tenant-service    && npm start   # :3101
cd services/audit-log-service && npm start   # :3102
cd services/tenant-service    && npm run test:e2e
```

Luu y: chay bang `tsx` (esbuild) nen **khong co decorator metadata** — moi tham so
constructor cua NestJS bat buoc phai co `@Inject(...)` tuong minh, neu khong DI
tra ve `undefined` luc chay chu khong bao loi luc build.

## Lay token test

```bash
curl -s -X POST http://localhost:8080/realms/Blegal/protocol/openid-connect/token \
  -d client_id=admin-portal -d username=dgnaw -d password='Test@12345' \
  -d grant_type=password -d scope='openid organization'
```

## Claim can quan tam

```
iss          = http://localhost:8080/realms/Blegal
sub          = 972ff7d0-...
organization = ["Vinasa"]          <-- MANG, khong phai chuoi
realm_access.roles = [..., "Tenant_Admin"]
```

Auth Guard phai xu ly: 1 phan tu -> lay; 0 phan tu -> 403; >1 phan tu -> 400
(bat client gui `scope=organization:<alias>` de Keycloak chi tra dung 1).

## Thu muc

```
infra/keycloak/realms.json     cau hinh realm-as-code (nguon su that)
infra/keycloak/bootstrap.py    script ap dung cau hinh len Keycloak
infra/keycloak/realms/         snapshot export tu Keycloak H2 ban dau (backup)
packages/auth-guard/           xac thuc JWT da realm (GD2)
packages/events/               envelope + Kafka producer/consumer (GD3)
services/tenant-service/       nguon su that cau hinh Tenant (GD3)
services/audit-log-service/    consumer audit, append-only (GD3)
services/                      tenant-service, orchestrator (GD3, GD5)
apps/                          admin portal UI (GD5)
```
