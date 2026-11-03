# MissionDesk Security

## Personal Pilot

The personal pilot requires an approved identity, server-side account checks and workspace membership. Engine-control APIs remain unavailable in personal mode. Source fetching and daily workspace quotas are unchanged by the security hardening.

Next.js and its matching ESLint configuration are pinned to 16.4.4. Run `npm run security:audit` before publishing and `npm run smoke:security-headers` with the existing access, profile, workspace search and refresh smoke tests. The `Pilot Security` GitHub workflow runs these checks on pilot-branch pushes and pull requests, using pinned official actions, read-only repository permissions, no application secrets and no deployment step. The production dependency audit was clean on 2026-11-03. Development-only ESLint/minimatch warnings remain; do not use `npm audit fix --force` to downgrade or replace the lint toolchain.

The personal proxy enforces frame denial, `nosniff`, a no-referrer policy and disabled camera/microphone/location/payment/USB access. It leaves legacy responses unchanged. CSP restrictions on scripts, objects, base URLs and form destinations are report-only during the pilot rollout, not an enforced XSS guarantee. Nonces are generated per request, forwarded to Next's renderer and never accepted from the browser. Inline styles remain allowed for framework compatibility. Reports currently appear in the browser console; source URLs, cookies and account data are not sent to a reporting service.

Before enforcing the script policy, verify a real signed-in session, search, prioritization, meeting print, login and logout, and check CSP messages. Also test the local development server and a production build; development-only WebSocket/eval allowances must not reach production. Auth0 response cookies and authorization redirects must be preserved.

## Provider Controls

Keep Auth0's closed username connection, existing password policy, brute-force protection and exact callback URLs. Do not share user credentials or force a new MFA requirement before enrollment and recovery have been tested. Administrators should enroll MFA separately on GitHub, Vercel, Neon and Auth0; an application-code change cannot enroll their devices. Check plan availability before enabling any chargeable factor. Never commit recovery codes or credentials.

The proposed Vercel WAF rule is scoped only to the `missiondesk-pilot` project: 300 matching requests per IP per 60-second fixed window, with a 429 response above the limit. Match `/api/` and the exact `/auth/login` path. Do not rate-limit `/auth/callback` or logout with this rule. The database's workspace quotas remain authoritative and are not replaced by an IP limit. Shared networks need reasonable headroom. Pro-plan WAF rate limiting is metered: obtain cost approval before enabling it, preserve other rules, and check for unrelated draft changes before publishing. Never use the team-level option or modify the legacy project's firewall.

`.github/dependabot.yml` prepares weekly version-update proposals for the pilot branch, grouping Next.js with its ESLint configuration and avoiding major upgrades. GitHub reads that file from the repository's default branch: it must be merged there before scheduled proposals become active. Adding it to the pilot branch alone does not activate Dependabot. Default-branch changes and deployment settings are not applied implicitly by pilot work.

## Scope

Treat MissionDesk as an open-source monitoring service, not a channel for confidential diplomatic material. HTTPS protects transport, not compromised devices, stolen credentials, false source content or every application bug. These checks are defense in depth, not a penetration test or security certification.
