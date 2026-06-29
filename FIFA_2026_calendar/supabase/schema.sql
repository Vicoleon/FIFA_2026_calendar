-- ============================================================
--  FIFA World Cup 2026 — esquema de base de datos (Supabase / Postgres)
--  Copia de respaldo del esquema aplicado vía migraciones.
--  Reaplica con: psql <conn> -f schema.sql   (o el SQL Editor de Supabase)
-- ============================================================

create table if not exists public.teams (
  id text primary key,
  name text not null,
  name_es text not null,
  flag text,
  group_code text,
  seed_pos smallint,
  confederation text,
  fifa_rank int,
  elo numeric not null default 1700
);

create table if not exists public.matches (
  id int primary key,
  stage text not null,
  group_code text,
  matchday smallint,
  home_team text references public.teams(id),
  away_team text references public.teams(id),
  home_placeholder text,
  away_placeholder text,
  venue text,
  venue_code text,
  kickoff timestamptz,
  home_score smallint,
  away_score smallint,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_stats (
  match_id int references public.matches(id) on delete cascade,
  team_id text references public.teams(id),
  possession smallint, shots smallint, shots_on_target smallint,
  corners smallint, fouls smallint, offsides smallint,
  yellow_cards smallint, red_cards smallint,
  primary key (match_id, team_id)
);

create table if not exists public.goals (
  id bigint generated always as identity primary key,
  match_id int references public.matches(id) on delete cascade,
  team_id text references public.teams(id),
  player text, minute smallint,
  own_goal boolean not null default false,
  penalty boolean not null default false
);

create table if not exists public.predictions (
  match_id int primary key references public.matches(id) on delete cascade,
  p_home_win numeric, p_draw numeric, p_away_win numeric,
  pred_home_score numeric, pred_away_score numeric,
  model text default 'elo-poisson-v1',
  updated_at timestamptz not null default now()
);

-- Row Level Security: lectura pública, escritura sólo para editores autorizados.
-- Edita la lista de correos en la función is_editor() para añadir editores.
alter table public.teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_stats enable row level security;
alter table public.goals enable row level security;
alter table public.predictions enable row level security;

create or replace function public.is_editor()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'email','') = any (array['joseleonsalgado@gmail.com']);
$$;

-- ============================================================
--  Realtime (marcadores y actualizaciones EN VIVO)
--  El frontend (assets/js/app.js) se suscribe a postgres_changes de estas
--  tablas. Sin agregarlas a la publicación supabase_realtime NO se emiten
--  eventos y la app no se actualiza sola. (Equivale a activar "Realtime" en
--  el panel de Supabase para cada tabla.)
-- ============================================================
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_stats;
alter publication supabase_realtime add table public.goals;

-- Fila completa en eventos UPDATE/DELETE (realtime robusto).
alter table public.matches     replica identity full;
alter table public.match_stats replica identity full;
alter table public.goals       replica identity full;
