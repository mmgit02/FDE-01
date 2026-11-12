# CLAUDE.md — GR_Automation_Demo Guardrails

- Only work in org **org_pocus**, space **POC**. Never run `cf8 target` to switch elsewhere.
- Never run `cf8 delete`, `cf8 delete-service`, or `cf8 undeploy` without asking the user first.
- Always show the full `cf8 push` command and wait for approval before running it.
- Never store passwords, service keys, or credentials in any file.
