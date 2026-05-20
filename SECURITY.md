# Security Policy

## Supported Versions

| Version | Status |
|---------|--------|
| Preprod (current) | Active development — not for real funds |
| Mainnet | Not yet deployed |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately by emailing: **security@nightmarkets.io** (or open a GitHub private security advisory at https://github.com/kingmunz1994-lgtm/night-markets/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected contract / component
- Your assessment of impact

We will respond within 72 hours and aim to patch critical issues within 7 days.

## Scope

| Component | In scope |
|-----------|----------|
| `NightMarketsEscrow.compact` | Yes — escrow state machine, ZK auth |
| `api-server.ts` | Yes — server-side custody logic, endpoint security |
| Frontend HTML files | Yes — XSS, CSRF, wallet interactions |
| Wallet seed / private keys | Out of scope — user responsibility |

## Known Limitations (Stage 1 — Preprod)

These are documented design decisions for Stage 1, not vulnerabilities:

- **Server-assisted custody**: The server wallet holds NIGHT on behalf of users. ZK auth is enforced on-chain; token movement is off-chain. Stage 2 will migrate to trustless DApp-connector atomic transactions.
- **Timelock enforcement**: The 14-day escrow expiry is enforced server-side, not in the Compact circuit. On-chain block-height verification will be added in Stage 2 when the Compact kernel exposes that primitive.
- **In-memory stores**: Listing, shipping, and rating data is held in RAM and does not persist across server restarts. A database backend is planned before mainnet.

## Audit Status

- No formal third-party audit completed yet.
- Community review findings tracked in GitHub Issues.
- Pre-mainnet audit planned via Midnight Network security partners.
