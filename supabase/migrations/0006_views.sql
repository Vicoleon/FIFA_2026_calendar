-- ============================================================
--  Quiniela 2026 · 0006 · vistas de tabla de posiciones + sabiduría de masas
--  Las vistas exponen SOLO agregados (nunca picks individuales).
-- ============================================================

-- Tabla GLOBAL (pública, también para marketing): bypassa RLS a propósito
-- pero solo muestra totales por usuario.
drop view if exists public.leaderboard_global;
create view public.leaderboard_global with (security_invoker = off) as
select
  p.user_id,
  pr.display_name,
  pr.avatar_url,
  pr.country,
  coalesce(sum(p.points), 0)::int                       as total_pts,
  count(*) filter (where p.exact)::int                  as exact_count,
  count(*) filter (where p.points is not null)::int     as played,
  max(p.updated_at) filter (where coalesce(p.points,0) > 0) as last_correct_at
from public.picks p
join public.profiles pr on pr.id = p.user_id
group by p.user_id, pr.display_name, pr.avatar_url, pr.country;

grant select on public.leaderboard_global to anon, authenticated;

-- Tabla POR GRUPO (privada): security_invoker => RLS limita a grupos del usuario.
-- (Los picks con puntos siempre son post-kickoff, así que el agregado es correcto.)
drop view if exists public.leaderboard_group;
create view public.leaderboard_group with (security_invoker = on) as
select
  gm.group_id,
  gm.user_id,
  gm.paid,
  pr.display_name,
  pr.avatar_url,
  pr.country,
  coalesce(sum(p.points), 0)::int                       as total_pts,
  count(*) filter (where p.exact)::int                  as exact_count,
  count(*) filter (where p.points is not null)::int     as played,
  max(p.updated_at) filter (where coalesce(p.points,0) > 0) as last_correct_at
from public.group_members gm
join public.profiles pr on pr.id = gm.user_id
left join public.picks p on p.user_id = gm.user_id
group by gm.group_id, gm.user_id, gm.paid, pr.display_name, pr.avatar_url, pr.country;

grant select on public.leaderboard_group to authenticated;

-- Sabiduría de masas: distribución de picks de un grupo para un partido (post-kickoff).
create or replace function public.group_pick_distribution(p_group uuid, p_match int)
returns table(outcome text, n int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group) then
    raise exception 'No perteneces a este grupo';
  end if;
  if not exists (select 1 from public.matches where id = p_match and kickoff is not null and kickoff <= now()) then
    raise exception 'Disponible después del inicio del partido';
  end if;
  return query
    select case
             when sign(pk.home_score - pk.away_score) > 0 then 'home'
             when sign(pk.home_score - pk.away_score) = 0 then 'draw'
             else 'away'
           end as outcome,
           count(*)::int
    from public.picks pk
    join public.group_members gm on gm.user_id = pk.user_id and gm.group_id = p_group
    where pk.match_id = p_match
    group by 1;
end; $$;

grant execute on function public.group_pick_distribution(uuid, int) to authenticated;
