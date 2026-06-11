# Quiniela Mundial 2026 — Design & Implementation Spec

**Date:** 2026-06-11
**Status:** Approved (build in progress)
**Owner:** Jose León Salgado (RubikSoft)
**Stack:** Static (no-build) HTML/CSS/vanilla JS + Supabase (Postgres, Auth, Realtime, Edge Functions, pg_cron). No separate server, no bundler.

---

## 1. Goal

Turn the existing read-only **"Mundial 2026"** calendar app into a social prediction game (**quiniela**): players sign in with Google, guess the score of each match, compete on global and group leaderboards, get reminded to play, and invite friends by link or email — plus 8 engagement features.

The existing calendar, "modo edición" (editor mode), per-match stats, and the **Elo+Poisson house predictor** are preserved unchanged. The quiniela is a **new layer** on top of them.

Every public surface carries **"Desarrollado por [www.rubik-soft.com](https://www.rubik-soft.com)"** in the footer, and every group invite (link + email) is RubikSoft-branded — turning the app into a passive marketing channel.

## 2. Non-goals

- No migration to React/Flask (the attached `dental-tourism` zip is unrelated and ignored).
- No real money movement. The prize pot is a **tracker only**.
- No non-Google auth (Google sign-in only). The existing OTP "editor mode" stays for result-loading.
- App language stays **Spanish**.

## 3. Roles (not mutually exclusive)

| Role | Who | Can |
|---|---|---|
| **Player** | any Google-authenticated user | make/edit own picks, join groups, invite, see leaderboards |
| **Editor** | email allowlist via `is_editor()` (unchanged) | load real results, stats, recalc house predictions |
| **Group owner** | created a group | manage members, set buy-in, mark paid, delete group |

## 4. Scoring rules

- **Exact score** (guess == final, both numbers) → **3 pts**
- **Correct outcome** only (right winner or right draw, wrong score) → **1 pt**
- Otherwise → **0 pts**
- **Joker / Doble:** if the player flagged the match as their joker for that matchday, points are **doubled** (6 or 2).
- **Lock:** a pick is editable until **that match's `kickoff`**; after kickoff it is read-only (enforced in UI **and** RLS).
- **Knockouts:** the guess input appears only once the bracket resolves both real teams for that fixture.

## 5. Data model (new, additive — all under RLS)

Existing tables (`teams`, `matches`, `match_stats`, `goals`, `predictions`) are untouched.

### `profiles`
- `id uuid pk references auth.users`
- `display_name text`, `avatar_url text`, `country text` (flag emoji/ISO), `email text`
- `autopick boolean default false` — opt into auto-pick safety net
- `created_at timestamptz default now()`
- **RLS:** anyone authenticated can `select` (name/avatar/country needed for leaderboards); user can `insert`/`update` only their own row. Auto-created on first login via trigger on `auth.users` or client upsert.

### `picks`
- `user_id uuid references auth.users`, `match_id int references matches`
- `home_score smallint`, `away_score smallint`
- `is_joker boolean default false`
- `source text default 'manual'` — `'manual'` | `'auto'`
- `points smallint` — computed, nullable until match finished
- `outcome_pts smallint`, `exact boolean` — breakdown for badges/digests
- `created_at`, `updated_at timestamptz`
- **pk** (`user_id`, `match_id`)
- **RLS (the security core):**
  - `select`: own picks always; **other users' picks only after `matches.kickoff` has passed** (anti-copy).
  - `insert`/`update`: only own row, only while `now() < matches.kickoff` (server-enforced lock).
  - `points`/`exact`/`outcome_pts` are written only by the scoring function (security definer), never by the client (revoke update on those columns or check in policy).

### `groups`
- `id uuid pk default gen_random_uuid()`, `name text`, `owner_id uuid`
- `join_code text unique` (short, shareable), `buy_in numeric default 0`, `currency text default 'MXN'`
- `created_at`
- **RLS:** members can `select`; owner can `update`/`delete`; any authenticated user can `insert` (becomes owner).

### `group_members`
- `group_id uuid references groups on delete cascade`, `user_id uuid`
- `paid boolean default false`, `role text default 'member'`, `joined_at`
- **pk** (`group_id`, `user_id`)
- **RLS:** members can `select` rows of their groups; user can `insert` self (join); owner can `update` (`paid`) and `delete` (kick).

### `invites`
- `id uuid pk`, `group_id uuid`, `token text unique`, `email text` (nullable for link invites)
- `invited_by uuid`, `accepted_by uuid` (nullable), `created_at`, `expires_at`
- **RLS:** group members can `select`/`insert`; lookup-by-token via a `security definer` RPC so an invitee who isn't yet a member can resolve & accept it.

### `achievements` (catalog) / `user_achievements`
- `achievements(code pk, name, description, emoji)`
- `user_achievements(user_id, code, match_id nullable, matchday nullable, group_id nullable, earned_at)` — pk (`user_id`,`code`,`coalesce(match_id...)`) handled with unique index.
- **RLS:** authenticated `select`; writes only by scoring function (security definer).

### Views (read-only, aggregate-only — never expose individual picks)
- `leaderboard_global(user_id, display_name, avatar_url, total_pts, exact_count, played, last_correct_at)`
- `leaderboard_group(group_id, user_id, ...)` — same, scoped & filtered to group members.
- `pick_distribution(match_id, outcome, n)` — crowd-wisdom %, only for matches past kickoff.

## 6. Scoring engine

- `public.recompute_match_scores(p_match_id int)` — `security definer`, idempotent. For the given finished match: for each pick, compute `exact`, `outcome_pts`, `points` (×2 if joker), write back. Then re-evaluate achievements touched by that match/matchday.
- **Trigger** `on matches after update of home_score, away_score, status`: when the match becomes `finished` with both scores set (or scores are corrected), call `recompute_match_scores(NEW.id)`. Setting status back to non-finished nulls the picks' points.
- Leaderboards are plain views summing `picks.points`; **Realtime** on `picks` (or a lightweight `leaderboard_pings` channel) drives live updates without refresh.

## 7. Groups, invites & prize pot

- **Create group** → server generates a unique `join_code` and the owner is added as a member.
- **Join** via code (typed) or **link** `index.html?invite=<token>` (auto-accept on login through the `accept_invite(token)` RPC).
- **Email invites:** owner enters emails → `send-email` Edge Function emails each a branded join link via Resend.
- **Prize pot tracker (per group):** owner sets `buy_in`; toggles each member `paid`. UI shows **pot = sum(buy_in over paid members)** and **projected payout to the current group leader**. No payments processed.

## 8. Leaderboards

- **Global** + **per-group** "Tabla de posiciones."
- **Rank order:** `total_pts desc`, then `exact_count desc` (more bullseyes), then `last_correct_at asc` (got there first). Stable + deterministic.
- **Live/provisional:** updates the instant the editor saves a score, via Realtime.

## 9. Email infrastructure (reminders + digest + invites)

- One Edge Function **`send-email`** wrapping **Resend** (`RESEND_API_KEY` secret). All transactional email goes through it; all templates carry the RubikSoft footer.
- **`pg_cron` daily** → `daily-reminder` function: email each player who has **un-guessed matches kicking off in the next ~36h**. Plus an **in-app banner** on load listing matches still to guess, with quick-pick.
- **`pg_cron` weekly (Mon AM)** → `weekly-digest` function: per-player email — points this week, rank movement ▲/▼, best call, worst miss, what to guess next.
- **`pg_cron` near-kickoff (every ~15 min)** → `auto-pick` function: for opted-in players, fill missing picks for matches about to lock using the house predicted score (`source='auto'`).

> Cron jobs invoke Edge Functions via `pg_net`/`supabase_functions.http_request` with the service role; functions read DB with service role and never trust client input for recipient lists.

## 10. The 8 engagement features

1. **Joker / Doble** — one double-points match per matchday (`picks.is_joker`; a partial unique index / trigger enforces one joker per `user_id` × `matchday`).
2. **Live provisional leaderboard** — §8, real-time rank shifts during match windows.
3. **Weekly email digest** — §9.
4. **Achievements & badges** — `Jornada Perfecta` (all of a matchday exact), `Racha` (3 exact in a row, chronologically), `Mataguigantes` (nailed a result the house rated <25%), `El Profeta` (matchday top scorer in a group), `Pleno` (full-card submitted). Shown on profile + next to names on leaderboards.
5. **Crowd wisdom + head-to-head** — after a match locks: % of your group on each outcome (`pick_distribution`), plus a side-by-side card compare vs one chosen rival.
6. **Auto-pick safety net** — opt-in (`profiles.autopick`); §9 cron fills misses from the Elo+Poisson score so opted-in players never sit at zero.
7. **Prize pot / buy-in tracker** — §7.
8. **Shareable result cards** — client-side `<canvas>` → PNG; share via Web Share API / WhatsApp deep link, **invite link + rubik-soft.com baked into the image**.

## 11. UI additions (existing visual language, Spanish)

- **Top bar:** Google **sign-in / avatar menu**; new tabs **Mi Quiniela**, **Grupos**, **Tabla**. Existing tabs (Grupos de la copa, Eliminatorias, Calendario) and "Modo edición" remain.
  - Naming note: the football "Grupos" (A–L) view and the social "Grupos" (friend groups) must be disambiguated in labels (e.g. **"Mis grupos"** for social).
- **Match card (signed in):** compact guess inputs (`home`/`away`) + Joker toggle + lock state + "tu pick / pick de la gente" reveal after kickoff.
- **New views:** `Tabla de posiciones` (global/group toggle, badges), `Mis grupos` (create/join/invite/pot), `Perfil` (badges, autopick toggle, stats, share card).
- **Footer (all pages):** `Desarrollado por www.rubik-soft.com`.

## 12. File organization (respect "many small files", <800 lines)

```
index.html
assets/css/styles.css            # extended
assets/js/
  config.js                      # + RESEND/site config knobs
  lib/supabase.js                # shared client + session/state
  lib/dom.js                     # $/$$/esc/fmt helpers (extracted)
  predictor.js  standings.js     # unchanged
  calendar.js                    # existing render/editor (extracted from app.js)
  auth.js                        # Google sign-in, profile, avatar menu
  picks.js                       # guess inputs, joker, locking
  groups.js                      # create/join, members, pot
  invites.js                     # link + email invite, accept flow
  leaderboard.js                 # global/group tables, realtime
  crowd.js                       # crowd wisdom + head-to-head
  achievements.js                # badge display
  share.js                       # canvas result cards
  reminders.js                   # in-app banner
  app.js                         # thin bootstrap wiring modules
supabase/
  migrations/*.sql               # additive migrations (applied live via MCP)
  functions/send-email/          # Resend wrapper
  functions/daily-reminder/
  functions/weekly-digest/
  functions/auto-pick/
docs/superpowers/specs/...
```

## 13. Security

RLS is the backbone:
- Pick privacy until kickoff; self-only writes; lock enforced server-side via `matches.kickoff`.
- `points`/`exact` columns un-writable by clients; only the `security definer` scoring fn sets them.
- Editor allowlist (`is_editor()`) unchanged.
- Invites are unguessable tokens with expiry; accept via `security definer` RPC.
- Leaderboard/crowd views expose **aggregates only**, never raw picks.
- Edge Functions verify JWT where user-facing; cron-only functions use service role and never trust a client-supplied recipient list.
- Supabase anon key remains public by design. No secrets in the static bundle; `RESEND_API_KEY` lives only as an Edge Function secret.

## 14. Testing

- **Pure JS logic** (scoring, tie-break ordering, joker doubling, pot/payout math, achievement predicates) unit-tested in a tiny no-dep harness runnable with `node`.
- **SQL**: seeded assertions for `recompute_match_scores` (exact/outcome/joker/correction-idempotency) and **RLS** (a non-owner cannot read pre-kickoff picks; cannot write others' picks; cannot write after kickoff).
- **Manual E2E checklist**: Google login → make picks → editor finishes a match → points + leaderboard update live → join group via link → invite by email → reminder/digest dry-run.

## 15. Build order (= implementation plan)

- **P0 — Setup & identity:** repo restructure (done); `profiles` table + trigger; Google sign-in UI + avatar menu; refactor `app.js` → `lib/*` + `calendar.js` shell. Footer added.
- **P1 — Picks & locking:** `picks` table + RLS; guess inputs + joker on cards; lock logic.
- **P2 — Scoring + global leaderboard:** scoring fn + trigger; `leaderboard_global` view; live updates; `Tabla` view.
- **P3 — Groups + invites + pot:** `groups`/`group_members`/`invites` + RLS + RPCs; `Mis grupos` view; per-group leaderboard; prize pot tracker; link + email invite.
- **P4 — Email:** `send-email` (Resend) + `daily-reminder` + `weekly-digest` functions; pg_cron; in-app reminder banner.
- **P5 — Extras:** crowd wisdom + head-to-head; achievements; auto-pick safety net; shareable result cards.
- **P6 — Review & verify:** security review (RLS), code review, test pass, manual E2E.

## 16. Manual setup required from Jose (the only "setup tax")

1. **Google OAuth client** (Google Cloud Console) → add Client ID/Secret to Supabase → Auth → Providers → Google; set Site URL + redirect (`https://<deploy-host>` and the GitHub Pages URL). *I cannot create Google credentials; ~10 min.*
2. **Resend** account → `RESEND_API_KEY` set as Supabase Edge Function secret; (optional) verify a sending domain — the Resend test domain works to start. *Needed before reminder/digest/invite emails send; everything else works without it.*
3. Supabase project `ozdjeotbfxnbisyedioq` access — **confirmed**; migrations & functions applied via MCP.

## 17. Open defaults (chosen; change anytime)

- Currency default `MXN`; pot payout = winner-take-all to current leader (display only).
- Daily reminder window: matches kicking off within 36h with no pick.
- Weekly digest: Mondays 14:00 UTC (≈ morning in MX). Daily reminder: 14:00 UTC.
- `Racha` = 3 chronologically consecutive exact-score picks.
