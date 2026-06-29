-- ============================================================
--  Quiniela 2026 · 0014 · auto-resolución del cuadro (W##/L##)
--  Cuando un partido de eliminación termina, escribe el equipo
--  que avanza (ganador/perdedor, definido por penales si hubo
--  empate) en el slot del partido de la siguiente ronda. Así el
--  servidor (sync-espn) puede emparejar el partido de R16+ con
--  ESPN y traer su marcador en vivo, sin intervención manual.
--
--  FILL-ONLY: nunca sobreescribe un equipo ya puesto (no toca
--  los equipos de R32 que vienen del sorteo/ESPN).
-- ============================================================

-- ganador/perdedor de un partido de eliminación terminado, o null si aún no se decide
create or replace function public.knockout_outcome(ph text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare m record; home_won boolean;
begin
  if ph is null or ph !~ '^[WL][0-9]+$' then return null; end if;
  select * into m from public.matches where id = substring(ph from 2)::int;
  if not found or m.status <> 'finished' or m.home_score is null or m.away_score is null
     or m.home_team is null or m.away_team is null then
    return null;
  end if;
  if m.home_score = m.away_score then
    if m.home_pens is null or m.away_pens is null or m.home_pens = m.away_pens then return null; end if;
    home_won := m.home_pens > m.away_pens;
  else
    home_won := m.home_score > m.away_score;
  end if;
  if left(ph, 1) = 'W' then
    return case when home_won then m.home_team else m.away_team end;
  else
    return case when home_won then m.away_team else m.home_team end;
  end if;
end; $$;

-- rellena todos los slots W##/L## resolubles; itera para que rondas tempranas alimenten posteriores
create or replace function public.resolve_knockout_teams()
returns int language plpgsql security definer set search_path = '' as $$
declare total int := 0; n int;
begin
  for _i in 1..8 loop
    update public.matches d set
      home_team = coalesce(d.home_team, public.knockout_outcome(d.home_placeholder)),
      away_team = coalesce(d.away_team, public.knockout_outcome(d.away_placeholder))
    where d.stage <> 'group'
      and ( (d.home_team is null and public.knockout_outcome(d.home_placeholder) is not null)
         or (d.away_team is null and public.knockout_outcome(d.away_placeholder) is not null) );
    get diagnostics n = row_count;
    total := total + n;
    exit when n = 0;
  end loop;
  return total;
end; $$;

-- trigger: al terminar un partido, resuelve los slots de la siguiente ronda.
-- escribe home_team/away_team (columnas NO vigiladas) => no se re-dispara.
create or replace function public.trg_resolve_knockout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.resolve_knockout_teams();
  return null;
end; $$;

drop trigger if exists matches_resolve_knockout on public.matches;
create trigger matches_resolve_knockout
  after update of status, home_score, away_score, home_pens, away_pens on public.matches
  for each row when (new.status = 'finished')
  execute function public.trg_resolve_knockout();

-- resolución inicial
select public.resolve_knockout_teams();
