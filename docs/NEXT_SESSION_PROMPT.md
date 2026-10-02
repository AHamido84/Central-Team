# Prompt for the next session

Paste this as the first message of a new Claude Code session on this repository.

---

You're continuing work on the Central Team platform (repo `AHamido84/Central-Team`, branch `claude/sharp-euler-zr273f`).

Before anything else, read `CLAUDE.md`, `docs/HANDOFF.md` (state, gotchas, production, open items, "Starting a new
session"), `docs/ROADMAP.md` (latest section: "Feedback Round 2") and `docs/DECISIONS.md` (ADR-001…088; the next ADR is
089).

State:
- Phases 0–8 and Feedback Rounds 1–2 are built, tested and deployed to https://centralteam.vercel.app (commit
  `7e600d4`).
- Feedback Round 2 added Settings → Mail and one outbox for every email, including auth links (ADR-088). Production
  delivers no email until a sender is configured there.
- Verified green on a fresh seed: 243 unit, 239 DB and 49 e2e tests, plus `pnpm build`.

Set up the local stack as described in HANDOFF "Starting a new session", then run `pnpm check` and `pnpm test:db` to
confirm it's green before changing anything. Follow every rule in `CLAUDE.md` (`defineAction` + `can()` + RLS, AR/EN,
RTL/LTR, light/dark, mobile, tests, docs and ROADMAP checkboxes, Conventional Commits with a lowercase subject).

Rules from the owner:
- Don't deploy unless I say so in this session. I'll give a Vercel token when needed; never store it.
- Never commit secrets.
- Plan a new feedback round in `docs/ROADMAP.md` first, show me the plan, then build in the order I give.
- End each round with a report (what changed and where to find it, a manual test checklist, decisions, anything
  deferred), then stop and wait.

My next request: <write it here>
