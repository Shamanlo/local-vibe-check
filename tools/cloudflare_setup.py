#!/usr/bin/env python3
"""Cloudflare Pages setup used by .github/workflows/deploy.yml.

    python3 tools/cloudflare_setup.py account   # find the account ID if not set
    python3 tools/cloudflare_setup.py project   # create the Pages project if missing
    python3 tools/cloudflare_setup.py domains   # attach custom domains and point DNS at Pages

Needs CLOUDFLARE_API_TOKEN (Pages:Edit, DNS:Edit, Zone:Read). CLOUDFLARE_ACCOUNT_ID
is optional; it is read from the DOMAIN zone. Safe to run repeatedly.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
PROJECT = os.environ.get("PROJECT", "local-vibe-check")
DOMAIN = os.environ.get("DOMAIN", "localvibecheck.site")
HOSTS = [DOMAIN, "www." + DOMAIN]

# Registrar parking records that block the site; anything else is left alone.
# (Namecheap parks on 162.255.119.x / 192.64.119.x; Cloudflare copies those in when a domain is added.)
PARKING = ("162.255.119.", "192.64.119.", "parkingpage.namecheap.com")


def call(method, path, body=None, ok=(200,)):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as err:
        payload = json.loads(err.read() or b"{}")
        if err.code in ok:
            return err.code, payload
        sys.exit(f"::error::Cloudflare API {method} {path} failed ({err.code}): {payload.get('errors')}")


def find_account():
    """Look up the account ID and export it for later workflow steps."""
    global ACCOUNT
    if not ACCOUNT:
        # The zone record carries its account, and needs only Zone:Read
        # (listing /accounts would need an extra Account Settings permission).
        # Before the domain is bought, fall back to any zone or account the token can see.
        _, res = call("GET", f"/zones?name={DOMAIN}")
        if not res["result"]:
            _, res = call("GET", "/zones?per_page=1")
        if res["result"]:
            account = res["result"][0]["account"]
        else:
            _, acc = call("GET", "/accounts?per_page=1", ok=(200, 403))
            if not acc.get("result"):
                sys.exit("::error::Token can't see any Cloudflare account; set a CLOUDFLARE_ACCOUNT_ID secret")
            account = acc["result"][0]
        ACCOUNT = account["id"]
        print(f"Using account {account.get('name', ACCOUNT)}")
    env_file = os.environ.get("GITHUB_ENV")
    if env_file:
        with open(env_file, "a") as f:
            f.write(f"CLOUDFLARE_ACCOUNT_ID={ACCOUNT}\n")


def ensure_project():
    status, _ = call("GET", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}", ok=(200, 404))
    if status == 404:
        call("POST", f"/accounts/{ACCOUNT}/pages/projects",
             {"name": PROJECT, "production_branch": "main"})
        print(f"Created Pages project {PROJECT}")
    else:
        print(f"Pages project {PROJECT} exists")


def ensure_domains():
    target = f"{PROJECT}.pages.dev"

    _, zones = call("GET", f"/zones?name={DOMAIN}")
    if not zones["result"]:
        # Add the domain to Cloudflare; needs Zone:Edit on the token.
        status, created = call("POST", "/zones", {"name": DOMAIN, "account": {"id": ACCOUNT}, "type": "full"}, ok=(200, 400, 403))
        if status != 200:
            print(f"::notice::Couldn't add {DOMAIN} to Cloudflare ({status}: {created.get('errors')}). Add it in the dashboard and re-run. Site is live on {target}.")
            return
        print(f"Added {DOMAIN} to Cloudflare; nameservers: {', '.join(created['result']['name_servers'])}")
        _, zones = call("GET", f"/zones?name={DOMAIN}")

    _, existing = call("GET", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}/domains")
    attached = {d["name"] for d in existing["result"]}
    for host in HOSTS:
        if host not in attached:
            call("POST", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}/domains", {"name": host})
            print(f"Attached {host} to {PROJECT}")
        else:
            print(f"{host} already attached")

    zone = zones["result"][0]
    print(f"Zone {DOMAIN} status: {zone['status']}")
    if zone["status"] != "active":
        ns = ", ".join(zone.get("name_servers", []))
        print(f"::notice::{DOMAIN} is waiting on its nameservers. At the registrar (Namecheap > Domain List > Manage > Nameservers > Custom DNS), set: {ns}")
    zid = zone["id"]

    for host in HOSTS:
        _, recs = call("GET", f"/zones/{zid}/dns_records?name={host}")
        good = False
        for r in recs["result"]:
            if r["type"] == "CNAME" and r["content"] == target:
                good = True
            elif r["type"] in ("A", "AAAA", "CNAME") and any(p in r["content"] for p in PARKING):
                call("DELETE", f"/zones/{zid}/dns_records/{r['id']}")
                print(f"Deleted parking record {r['type']} {host} -> {r['content']}")
            elif r["type"] in ("A", "AAAA", "CNAME"):
                print(f"::warning::Left {r['type']} {host} -> {r['content']} in place; remove it so {host} serves the site")
        if not good:
            call("POST", f"/zones/{zid}/dns_records",
                 {"type": "CNAME", "name": host, "content": target, "proxied": True, "ttl": 1})
            print(f"Created CNAME {host} -> {target}")
        else:
            print(f"CNAME {host} -> {target} already set")


if __name__ == "__main__":
    {"account": find_account, "project": ensure_project, "domains": ensure_domains}[sys.argv[1]]()
