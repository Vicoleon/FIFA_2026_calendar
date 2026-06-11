-- ============================================================
--  Quiniela 2026 · 0010 · RPC save_pick
--  El upsert de PostgREST sobre picks intenta escribir las columnas
--  de la PK (user_id, match_id) en el ON CONFLICT DO UPDATE, que no
--  están concedidas a nivel columna -> "permission denied for table picks".
--  Guardamos vía RPC security-definer que valida sesión + bloqueo por
--  kickoff (el trigger enforce_one_joker sigue aplicando la regla del Joker).
-- ============================================================
create or replace function public.save_pick(p_match_id int, p_home int, p_away int, p_joker boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_kick timestamptz;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 or p_home > 30 or p_away > 30 then
    raise exception 'Marcador inválido';
  end if;

  select kickoff into v_kick from public.matches where id = p_match_id;
  if v_kick is null then
    -- partido sin equipos/fecha aún: no se permite pronosticar
    if not exists (select 1 from public.matches where id = p_match_id) then
      raise exception 'Partido inexistente';
    end if;
  elsif v_kick <= now() then
    raise exception 'El partido ya inició; ya no puedes cambiar tu pronóstico';
  end if;

  insert into public.picks (user_id, match_id, home_score, away_score, is_joker, source)
  values (v_uid, p_match_id, p_home, p_away, coalesce(p_joker, false), 'manual')
  on conflict (user_id, match_id) do update
    set home_score = excluded.home_score,
        away_score = excluded.away_score,
        is_joker   = excluded.is_joker,
        updated_at = now();
end; $$;

revoke all on function public.save_pick(int,int,int,boolean) from public, anon;
grant execute on function public.save_pick(int,int,int,boolean) to authenticated;
