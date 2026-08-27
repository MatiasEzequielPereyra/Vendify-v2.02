-- ============================================================
-- Vendify v2.7
-- Contraseña fija definida por owner + limpieza de flags
-- ============================================================

begin;

-- Los empleados ya no deben cambiar contraseña obligatoriamente.
alter table public.empleados
  alter column debe_cambiar_password set default false;

update public.empleados
set debe_cambiar_password = false
where debe_cambiar_password = true;

-- La función queda por compatibilidad, pero simplemente confirma false.
create or replace function public.marcar_password_empleado_cambiada()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida';
  end if;

  update public.empleados
     set debe_cambiar_password = false,
         actualizado = now()
   where user_id = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.marcar_password_empleado_cambiada() from public;
grant execute on function public.marcar_password_empleado_cambiada() to authenticated;

notify pgrst, 'reload schema';

commit;
