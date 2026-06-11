-- ============================================================
--  Quiniela 2026 · 0005 · motor de puntaje
--  Exacto = 3, resultado correcto = 1, Joker = x2. Idempotente.
--  Trigger en matches: recalcula al terminar/corregir un partido.
-- ============================================================

create or replace function public.recompute_match_scores(p_match_id int)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select * into m from public.matches where id = p_match_id;
  if m is null then return; end if;

  if m.status = 'finished' and m.home_score is not null and m.away_score is not null then
    update public.picks p set
      exact = (p.home_score = m.home_score and p.away_score = m.away_score),
      outcome_pts = case
        when sign(p.home_score - p.away_score) = sign(m.home_score - m.away_score) then 1 else 0 end,
      points = (
        case
          when (p.home_score = m.home_score and p.away_score = m.away_score) then 3
          when sign(p.home_score - p.away_score) = sign(m.home_score - m.away_score) then 1
          else 0
        end
        * case when p.is_joker then 2 else 1 end
      ),
      updated_at = now()
    where p.match_id = p_match_id;
  else
    -- partido no terminado o marcador borrado: limpiar puntaje.
    update public.picks p set points = null, exact = null, outcome_pts = null, updated_at = now()
    where p.match_id = p_match_id and (p.points is not null or p.exact is not null);
  end if;

  perform public.evaluate_achievements_for_match(p_match_id);
end; $$;

-- Trigger: solo cuando cambian marcador o estado.
create or replace function public.trg_match_score_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_match_scores(new.id);
  return new;
end; $$;

drop trigger if exists matches_score_change on public.matches;
create trigger matches_score_change
  after update of home_score, away_score, status on public.matches
  for each row
  when (
    new.status     is distinct from old.status
    or new.home_score is distinct from old.home_score
    or new.away_score is distinct from old.away_score
  )
  execute function public.trg_match_score_change();

-- Permitir recalcular manualmente a un editor (por si se corrige histórico).
grant execute on function public.recompute_match_scores(int) to authenticated;
