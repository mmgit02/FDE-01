# CLAUDE.md — GR_Automation_Demo Guardrails

- Only work in org **org_pocus**, space **POC**. Never run `cf8 target` to switch elsewhere.
- Never run `cf8 delete`, `cf8 delete-service`, or `cf8 undeploy` without asking the user first.
- Always show the `cf8 deploy` / `cf8 push` command before running it.
- Never store passwords, service keys, or credentials in any file.

## Project notes

- Stateless CAP (Node) service in `srv/`, approuter + UI in `app/` (`app/resources`).
- S/4HANA is reached only through the BTP destination `DED_HTTP_200` (SAP Cloud SDK); no URLs or credentials in code.
- Tests: `npm test` (extraction + matching logic, no network).
- Deploy: `cf8 push -f manifest.yml` (apps `gr-automation-srv` and `gr-automation-app`).
