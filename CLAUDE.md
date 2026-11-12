# CLAUDE.md — GR_Automation_Demo Guardrails

## CF Target Restrictions
- **Only** work in org `org_pocus`, space `POC`.
- Never run `cf8 target` to switch to a different org or space.
- Never deploy to any other org/space without explicit user confirmation.

## Destructive Operations — ALWAYS ASK FIRST
- Never run `cf8 delete` without asking the user first.
- Never run `cf8 delete-service` without asking the user first.
- Never run `cf8 undeploy` without asking the user first.

## Deployment Safety
- Always show the full `cf8 deploy` / `cf8 push` command to the user before running it.
- Wait for explicit user confirmation before executing any destructive CF operation.

## Secret Hygiene
- Never store passwords, service keys, or credentials in any file.
- Credentials belong in CF environment variables or GitHub Actions secrets only.
- GitHub Actions secrets in use: CF_USERNAME, CF_PASSWORD, CF_API_URL, CF_ORG, CF_SPACE
