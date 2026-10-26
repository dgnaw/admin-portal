#!/usr/bin/env python3
import http.client
import json, os, sys, time, urllib.request, urllib.error, urllib.parse

KC = os.environ.get("KEYCLOAK_URL", "http://localhost:8080").rstrip("/")
USER = os.environ.get("KEYCLOAK_ADMIN_USER", "sysadmin")
PASS = os.environ.get("KEYCLOAK_ADMIN_PASS", "sysadmin")
CFG = json.load(open(os.path.join(os.path.dirname(__file__), "realms.json")))


def req(method, path, body=None, token=None, raw=False, text=False):
    url = path if path.startswith("http") else KC + path
    data = None
    headers = {}
    if body is not None:
        if raw:
            data = urllib.parse.urlencode(body).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif text:
            data = body.encode()
            headers["Content-Type"] = "application/json"
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw_body = resp.read()
            return resp.status, (json.loads(raw_body) if raw_body else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except (urllib.error.URLError, http.client.HTTPException, ConnectionError) as e:
        return 0, str(e)


def wait_ready(timeout=180):
    print("Dang doi Keycloak san sang...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, _ = req("GET", "/realms/master/.well-known/openid-configuration")
        if code == 200:
            print("Keycloak da san sang!")
            return
        time.sleep(2)
    sys.exit("Keycloak khong san sang sau %ds" % timeout)


def admin_token():
    code, body = req("POST", "/realms/master/protocol/openid-connect/token",
                     {"client_id": "admin-cli", "username": USER,
                      "password": PASS, "grant_type": "password"}, raw=True)
    if code != 200:
        sys.exit("Khong lay duoc admin token: %s %s" % (code, body))
    return body["access_token"]


def ensure(label, method, path, body, token, exists_ok=(409,), text=False):
    code, resp = req(method, path, body, token, text=text)
    if code in (200, 201, 204):
        print("  + %s" % label)
    elif code in exists_ok:
        print("  = %s (da ton tai)" % label)
    else:
        print("  ! %s -> %s %s" % (label, code, resp))
    return code


def upsert_user(rn, u, org, t):
    profile = {
        "username": u["username"], "email": u["email"],
        "firstName": u.get("firstName", u["username"]),
        "lastName": u.get("lastName", u["username"]),
        "enabled": True, "emailVerified": True, "requiredActions": [],
    }
    ensure("user %s" % u["username"], "POST", "/admin/realms/%s/users" % rn,
           dict(profile, credentials=[{"type": "password", "value": u["password"],
                                       "temporary": False}]), t)
    q = urllib.parse.urlencode({"username": u["username"], "exact": "true"})
    _, found = req("GET", "/admin/realms/%s/users?%s" % (rn, q), token=t)
    uid = found[0]["id"]

    ensure("  dong bo profile %s" % u["username"], "PUT",
           "/admin/realms/%s/users/%s" % (rn, uid), profile, t)

    if org:
        oid, alias = org
        ensure("  member %s -> %s" % (u["username"], alias), "POST",
               "/admin/realms/%s/organizations/%s/members" % (rn, oid), uid, t,
               exists_ok=(409,), text=True)

    _, role = req("GET", "/admin/realms/%s/roles/%s" % (rn, u["role"]), token=t)
    ensure("  role %s -> %s" % (u["role"], u["username"]), "POST",
           "/admin/realms/%s/users/%s/role-mappings/realm" % (rn, uid), [role], t)


def configure_org_mapper(rn, t):
    _, scopes = req("GET", "/admin/realms/%s/client-scopes" % rn, token=t)
    scope = next((c for c in scopes if c["name"] == "organization"), None)
    if not scope:
        print("  ! khong tim thay client scope organization")
        return
    mapper = next((m for m in scope.get("protocolMappers", [])
                   if m["protocolMapper"] == "oidc-organization-membership-mapper"), None)
    if not mapper:
        print("  ! khong tim thay organization membership mapper")
        return
    cfg = dict(mapper["config"])
    cfg.update({"addOrganizationAttributes": "true", "addOrganizationId": "true"})
    ensure("mapper organization (+attributes)", "PUT",
           "/admin/realms/%s/client-scopes/%s/protocol-mappers/models/%s" % (rn, scope["id"], mapper["id"]),
           dict(mapper, config=cfg), t)


def configure_audience_mapper(rn, client_id, t):
    q = urllib.parse.urlencode({"clientId": client_id})
    _, found = req("GET", "/admin/realms/%s/clients?%s" % (rn, q), token=t)
    if not found:
        return
    cid = found[0]["id"]
    _, mappers = req("GET", "/admin/realms/%s/clients/%s/protocol-mappers/models" % (rn, cid), token=t)
    if any(m["name"] == "audience" for m in mappers):
        print("  = audience mapper %s (da ton tai)" % client_id)
        return
    ensure("audience mapper %s" % client_id, "POST",
           "/admin/realms/%s/clients/%s/protocol-mappers/models" % (rn, cid), {
               "name": "audience", "protocol": "openid-connect",
               "protocolMapper": "oidc-audience-mapper",
               "config": {"included.client.audience": client_id,
                          "access.token.claim": "true",
                          "introspection.token.claim": "true"},
           }, t)


def configure_service_client(rn, spec, t):
    cid_name = spec["clientId"]
    q = urllib.parse.urlencode({"clientId": cid_name})
    _, found = req("GET", "/admin/realms/%s/clients?%s" % (rn, q), token=t)
    if not found:
        return
    cid = found[0]["id"]

    for role in spec.get("roles", []):
        ensure("  client role %s" % role, "POST",
               "/admin/realms/%s/clients/%s/roles" % (rn, cid), {"name": role}, t)

    _, sa = req("GET", "/admin/realms/%s/clients/%s/service-account-user" % (rn, cid), token=t)
    if not sa:
        return
    granted = []
    for role in spec.get("roles", []):
        _, r = req("GET", "/admin/realms/%s/clients/%s/roles/%s" % (rn, cid, role), token=t)
        if r:
            granted.append(r)
    if granted:
        ensure("  gan client role -> service account", "POST",
               "/admin/realms/%s/users/%s/role-mappings/clients/%s" % (rn, sa["id"], cid),
               granted, t)


def ensure_org(rn, org, sep, t):
    composite = "%s%s%s" % (rn, sep, org["alias"])
    body = {
        "name": org["name"], "alias": org["alias"], "enabled": True,
        "domains": [{"name": org["domain"]}],
        "attributes": {
            "composite_tenant_id": [composite],
            "product_code": [rn],
            "tenant_code": [org["alias"]],
            "is_root_tenant": ["true" if org.get("root") else "false"],
        },
    }
    ensure("org %s (%s)" % (org["alias"], composite), "POST",
           "/admin/realms/%s/organizations" % rn, body, t)
    _, orgs = req("GET", "/admin/realms/%s/organizations" % rn, token=t)
    oid = next((o["id"] for o in orgs if o["alias"] == org["alias"]), None)
    ensure("  attributes %s" % org["alias"], "PUT",
           "/admin/realms/%s/organizations/%s" % (rn, oid), dict(body, id=oid), t)
    return oid


def main():
    wait_ready()
    t = admin_token()

    sep = CFG.get("separator", "_")

    for realm in CFG["realms"]:
        rn = realm["name"]
        if sep and sep in rn:
            sys.exit("Ten realm %s chua dau phan cach %s" % (rn, sep))
        print("Realm %s" % rn)
        realm_settings = {
            "realm": rn, "enabled": True, "organizationsEnabled": True,
            "loginWithEmailAllowed": True, "registrationAllowed": False,
            "accessTokenLifespan": 300,
        }
        ensure("realm", "POST", "/admin/realms", realm_settings, t)
        ensure("  dong bo cau hinh realm", "PUT", "/admin/realms/%s" % rn, realm_settings, t)

        for role in CFG["roles"]:
            ensure("role %s" % role, "POST", "/admin/realms/%s/roles" % rn, {"name": role}, t)

        ensure("client %s" % CFG["client"]["clientId"], "POST",
               "/admin/realms/%s/clients" % rn, CFG["client"], t)
        ensure("client %s" % CFG["serviceClient"]["clientId"], "POST",
               "/admin/realms/%s/clients" % rn, CFG["serviceClient"], t)
        configure_audience_mapper(rn, CFG["client"]["clientId"], t)
        configure_audience_mapper(rn, CFG["serviceClient"]["clientId"], t)
        configure_service_client(rn, CFG["serviceClient"], t)
        configure_org_mapper(rn, t)

        for u in realm.get("users", []):
            upsert_user(rn, u, None, t)

        for org in realm.get("organizations", []):
            if sep and sep in org["alias"]:
                sys.exit("Alias %s chua dau phan cach %s" % (org["alias"], sep))
            oid = ensure_org(rn, org, sep, t)

            for u in org.get("users", []):
                upsert_user(rn, u, (oid, org["alias"]), t)

    print("\nXong.")


if __name__ == "__main__":
    main()
