-- ============================================================
--  Quiniela 2026 · 0002 · picks (pronósticos del usuario)
--  Un pick por (usuario, partido): marcador exacto + Joker.
--  Privacidad: los picks ajenos solo son visibles DESPUÉS del kickoff.
-- ============================================================

create table if not exists public.picks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  match_id    int  not null references public.matches(id) on delete cascade,
  home_score  smallint not null check (home_score >= 0 and home_score <= 30),
  away_score  smallint not null check (away_score >= 0 and away_score <= 30),
  is_joker    boolean not null default false,
  source      text not null default 'manual' check (source in ('manual','auto')),
  points      smallint,          -- calculado por el motor de puntaje (no editable por cliente)
  outcome_pts smallint,
  exact       boolean,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, match_id)
);

create index if not exists picks_match_idx on public.picks(match_id);
create index if not exists picks_user_idx  on public.picks(user_id);

alter table public.picks enable row level security;

-- SELECT: mis picks siempre; los de otros SOLO si el partido ya arrancó (anti-copia).
drop policy if exists picks_select on public.picks;
create policy picks_select on public.picks
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = picks.match_id and m.kickoff is not null and m.kickoff <= now()
    )
  );

-- INSERT: solo el propio usuario y SOLO antes del kickoff.
drop policy if exists picks_insert on public.picks;
create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id and (m.kickoff is null or m.kickoff > now())
    )
  );

-- UPDATE: solo el propio usuario y SOLO antes del kickoff.
drop policy if exists picks_update on public.picks;
create policy picks_update on public.picks
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and (m.kickoff is null or m.kickoff > now()))
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and (m.kickoff is null or m.kickoff > now()))
  );

-- DELETE: propio + antes del kickoff.
drop policy if exists picks_delete on public.picks;
create policy picks_delete on public.picks
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and (m.kickoff is null or m.kickoff > now()))
  );

-- Bloqueo a nivel columna: el cliente NUNCA escribe points/exact/outcome_pts/source.
revoke all on public.picks from anon;
revoke all on public.picks from authenticated;
grant select on public.picks to authenticated;
grant insert (user_id, match_id, home_score, away_score, is_joker) on public.picks to authenticated;
grant update (home_score, away_score, is_joker, updated_at) on public.picks to authenticated;
grant delete on public.picks to authenticated;

-- ── Joker: máximo uno por jornada (fase de grupos) / por ronda (eliminatorias) ──
create or replace function public.enforce_one_joker()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_md smallint; v_stage text;
begin
  if new.is_joker then
    select matchday, stage into v_md, v_stage from public.matches where id = new.match_id;
    if exists (
      select 1
      from public.picks p
      join public.matches m on m.id = p.match_id
      where p.user_id = new.user_id
        and p.is_joker
        and p.match_id <> new.match_id
        and m.stage = v_stage
        and ( (v_md is not null and m.matchday = v_md) or (v_md is null) )
    ) then
      raise exception 'Solo puedes tener un Joker por jornada/ronda';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists picks_one_joker on public.picks;
create trigger picks_one_joker
  before insert or update on public.picks
  for each row execute function public.enforce_one_joker();
