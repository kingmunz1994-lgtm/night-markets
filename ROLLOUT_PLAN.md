# Night Ecosystem — Rollout Plan

Last updated: 2026-05-16

This is the product rollout plan. LAUNCH_ROADMAP.md is the technical checklist.
This document answers: in what order do real people start using things, and why.

---

## The Honest Starting Point

One deployed contract (NightMarketsEscrow). Nine frontends. No real users yet.
Everything else follows from getting the first real transaction witnessed by a real person.

---

## Stage 1 — Prove it works
**Night Markets end-to-end**

One real person, one real listing, one real escrow release.
Not a demo. Not a screenshot. Actual tDUST moving on preprod.

What's needed:
- [ ] Escrow routes added to nightid-api.ts (so Railway handles them — not just localhost)
- [ ] NM_API in index.html updated to Railway URL (not localhost:3001)
- [ ] Proof server accessible to Railway (or escrow runs client-side via Lace)
- [ ] Full local test first: proof server + api-server + file server
- [ ] Then external test with one real user on Lace

Target audience: Midnight Discord, Cardano ZK builders, people already running Lace
Success metric: 10 people complete a transaction
What opens: Night Share epoch 1 starts collecting escrow fees from day one

---

## Stage 2 — Give people an identity
**Night ID — claim your .night name**

"Claim your name before someone else does."
Every early user gets a .night name tied to their Night Score.
Creates stake in the ecosystem before most things are deployed.

What's needed:
- [ ] Night ID frontend polished and clear
- [ ] .night name registration working end-to-end
- [ ] Night Score visible and updating on real actions

Target: same early users, plus their networks
Success metric: 50 .night names registered
What opens: every other app now has a user base with identity

---

## Stage 3 — Make it social
**Night Poker goes live**

Poker is the viral mechanic. One person plays, they need opponents, they invite people.
ZK showdown is the "wow" moment that gets shared.
Provably fair poker is something people can explain to non-crypto friends.

What's needed:
- [ ] night-poker contract deployed
- [ ] commitHand / claimPot ZK circuits wired
- [ ] WS room management tested with 2+ real players

Target: crypto gamers, Cardano community, general poker players
Success metric: 5 tables running simultaneously
What opens: Night Score starts accumulating from real game activity

---

## Stage 4 — Make it economic
**Night Work goes live**

AI agents post tasks. Humans earn DUST. First real batch payroll.
First real economic activity beyond speculation.

What's needed:
- [ ] night-work contract deployed (includes batch payroll)
- [ ] Task posting and claiming wired to contract
- [ ] First real task posted, first real DUST earned

Target: freelancers, developers, AI builders
Success metric: 20 tasks completed, first batch payroll run
What opens: Night Share pool starts filling from task fees

---

## Stage 5 — The cooperative moment
**Night Share — Epoch 1 distribution**

Even if the pool is small — £50 worth of DUST — this makes everything real.
Real revenue, real distribution, real cooperative.
Post the numbers publicly. This is the story that gets shared.

What's needed:
- [ ] NightRevenuePool contract deployed
- [ ] Escrow fee (1-2%) wired into revenue pool on releaseEscrow
- [ ] Task fee wired into revenue pool on verifyTask
- [ ] First epoch opened, snapshot taken, DUST distributed

Target: everyone already in the ecosystem
Success metric: every active user receives something, however small
What opens: Night Hub landing page now has a story with evidence behind it

---

## Stage 6 — Open the front door
**Night Hub full vision rewrite**

Real transactions. Real users. Real revenue sharing.
The landing page stops being a promise and becomes a proof.
Night Co-op, Night Vote, Night Data shown as coming next — with credibility.

What's needed:
- [ ] All app status badges (Live / Beta / Coming Soon)
- [ ] Night Share section on landing (not just dashboard)
- [ ] Night Pay, Night Vote, Night Co-op, Night Data shown as planned
- [ ] Real numbers: transactions count, DUST distributed, users

Target: broader Cardano community, ZK enthusiasts, privacy advocates
Success metric: 500 unique visitors, 100 wallet connections

---

## Stage 7 — DeFi layer
**Night Lend + Night Save**

Deposit DUST, earn yield. Borrow privately.
Night Score feeds into Night Lend creditworthiness.
Your on-chain reputation unlocks better rates.

What's needed:
- [ ] night-lend contract deployed
- [ ] night-save contract deployed
- [ ] Night Score → credit scoring wired in Night Lend

---

## Stage 8 — Governance
**Night Vote — first ecosystem vote**

What gets built next. How Night Share is distributed.
Which Night Co-op projects get backing.
The community has a voice. It stops being your project and becomes theirs.

What's needed:
- [ ] Night Vote contract written and deployed
- [ ] First vote topic: community-decided
- [ ] Night Score = voting weight

---

## Stage 9 — The vision apps
**Night Co-op, Night Data, Night Pay**

By here: users, revenue, identity, governance.
The big vision apps land on solid ground.
Night Data for medical records becomes a genuine pitch to healthcare institutions.

Night Co-op: ZK cooperative project launches, revenue share locked in contract, no dump
Night Data: sell proofs about your data (not raw data), earn DUST, own your information
Night Pay: send DUST to a .night name — the everyday utility layer

---

## Stage 10 — Mainnet
**When Midnight is ready**

Everything moves from preprod to mainnet.
DUST sponsorship covers fees for new users.
Real money, real stakes, real cooperative.

---

## Honest Timelines

| Stage | Realistic |
|---|---|
| 1–2 | Now — 2 weeks |
| 3–4 | Next month |
| 5–6 | 6 weeks |
| 7–8 | 3 months |
| 9 | 6 months |
| 10 | When Midnight says so |

---

## The Cardano Integration Story (Long Term)

Cardano has built great things — scattered across the ecosystem:
- Atala PRISM → Night ID
- Project Catalyst → Night Vote + Night Co-op
- Marlowe/DeFi → Night Lend + Night Save
- RealFi vision → Night Data (medical records)
- Cardano NFTs → Night Markets
- Midnight itself → the privacy layer all of it needs

Night Hub is the integration layer. One identity, one score, one wallet, all apps
talking to each other, privacy by default on everything.

The bridge from ADA → DUST is the critical infrastructure that unlocks this.
That bridge doesn't exist yet and isn't ours to build — it comes from the Midnight team.
Everything in Stages 1–9 can be done without it. It becomes the growth unlock for Stage 10+.

---

## The Vision in One Line

"Everything Cardano promised. Finally working together. With the privacy it always needed."
