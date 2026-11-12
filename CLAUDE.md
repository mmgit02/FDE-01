# BTP Development Guardrails — GR Automation Demo

## Target Environment
- **Org:** org_pocus
- **Space:** POC
- **Region:** us10 (api.cf.us10.hana.ondemand.com)
- **GitHub repo:** mmgit02/FDE-01
- **BTP Destination:** DED_HTTP_200 (S/4HANA)

## Rules
- Only operate in org `org_pocus`, space `POC`. Never `cf8 target` elsewhere.
- **Never** run `cf8 delete`, `cf8 delete-service`, or `cf8 undeploy` without explicit approval.
- Always show `cf8 deploy`/`cf8 push` command and wait for confirmation before running.
- Never ask for, print, or store passwords/service keys in any file.
- Use SQLite for local dev (`cds watch`), HANA Cloud for BTP production.

## Architecture
- **Backend:** SAP CAP (Node.js) — `srv/gr-service.js`
- **Frontend:** Fiori-style HTML5 — `app/`
- **Data model:** `db/schema.cds`
- **BTP deployment:** `manifest.yml` (cf push) or `mta.yaml` (cf deploy MTA)
