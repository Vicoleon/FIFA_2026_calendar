-- ============================================================
--  Quiniela 2026 · 0007 · endurecimiento de seguridad
--  - Oculta funciones internas/trigger/scoring de la API REST
--    (evita que un cliente llame p.ej. /rpc/_award y se auto-otorgue logros).
--  - Restringe RPCs de cliente a usuarios autenticados (sin anon/PUBLIC).
--  - leaderboard_global pasa a security_invoker (deja de saltarse RLS).
-- ============================================================

-- 1) Funciones internas / triggers / motor de puntaje: NO expuestas.
revoke all on function public.handle_new_user()                    from public, anon, authenticated;
revoke all on function public.trg_match_score_change()             from public, anon, authenticated;
revoke all on function public.enforce_one_joker()                  from public, anon, authenticated;
revoke all on function public._award(uuid,text,int,smallint,uuid) from public, anon, authenticated;
revoke all on function public._evaluate_matchday(smallint)         from public, anon, authenticated;
revoke all on function public.evaluate_achievements_for_match(int) from public, anon, authenticated;
revoke all on function public.recompute_match_scores(int)          from public, anon, authenticated;

-- 2) RPCs de cliente: solo authenticated.
revoke all on function public.create_group(text,numeric,text)      from public, anon;
revoke all on function public.join_group_by_code(text)             from public, anon;
revoke all on function public.create_invite(uuid,text)             from public, anon;
revoke all on function public.accept_invite(text)                  from public, anon;
revoke all on function public.set_member_paid(uuid,uuid,boolean)   from public, anon;
revoke all on function public.leave_group(uuid)                    from public, anon;
revoke all on function public.remove_member(uuid,uuid)             from public, anon;
revoke all on function public.group_pick_distribution(uuid,int)    from public, anon;
grant execute on function public.create_group(text,numeric,text)      to authenticated;
grant execute on function public.join_group_by_code(text)             to authenticated;
grant execute on function public.create_invite(uuid,text)             to authenticated;
grant execute on function public.accept_invite(text)                  to authenticated;
grant execute on function public.set_member_paid(uuid,uuid,boolean)   to authenticated;
grant execute on function public.leave_group(uuid)                    to authenticated;
grant execute on function public.remove_member(uuid,uuid)             to authenticated;
grant execute on function public.group_pick_distribution(uuid,int)    to authenticated;

-- 3) Helpers usados por RLS: authenticated (sin anon).
revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.is_group_owner(uuid)  from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid)  to authenticated;

-- 4) invite_info: vista previa del grupo aun sin sesión (link de invitación).
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

-- 5) leaderboard_global -> security_invoker (no se salta RLS).
--    Los picks con puntos SIEMPRE son post-kickoff, así que cualquier usuario
--    autenticado puede leerlos y el agregado total es correcto.
drop view if exists public.leaderboard_global;
create view public.leaderboard_global with (security_invoker = on) as
select
  p.user_id, pr.display_name, pr.avatar_url, pr.country,
  coalesce(sum(p.points), 0)::int as total_pts,
  count(*) filter (where p.exact)::int as exact_count,
  count(*) filter (where p.points is not null)::int as played,
  max(p.updated_at) filter (where coalesce(p.points,0) > 0) as last_correct_at
from public.picks p join public.profiles pr on pr.id = p.user_id
group by p.user_id, pr.display_name, pr.avatar_url, pr.country;
revoke all on public.leaderboard_global from anon;
grant select on public.leaderboard_global to authenticated;
