-- ============================================================
--  Quiniela 2026 · 0009 · RPC delete_group
--  Borrar un grupo es la única operación que faltaba: la tabla
--  groups no tiene GRANT DELETE para clientes (a propósito), así
--  que se hace vía RPC security-definer validando al dueño.
--  (group_members e invites se borran por ON DELETE CASCADE.)
-- ============================================================
create or replace function public.delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(p_group) then
    raise exception 'Solo el dueño del grupo puede eliminarlo';
  end if;
  delete from public.groups where id = p_group;
end; $$;

revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;
