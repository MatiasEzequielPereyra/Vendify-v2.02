-- ============================================================
-- Vendify v2.1 — Migración 003
-- Alta automática de negocio para nuevos usuarios de Auth
-- Ejecutar DESPUÉS de 001 y 002.
-- ============================================================

begin;

create or replace function public.crear_entorno_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio_id uuid;
  v_sucursal_id uuid;
  v_nombre text;
begin
  if exists (select 1 from public.negocio_miembros where user_id = new.id) then
    return new;
  end if;

  v_nombre := nullif(trim(coalesce(new.raw_user_meta_data->>'business_name','')), '');
  if v_nombre is null then
    v_nombre := coalesce(nullif(split_part(coalesce(new.email,''),'@',1),''), 'Mi negocio');
  end if;

  insert into public.negocios(nombre, email, plan, activo)
  values (v_nombre, new.email, 'starter', true)
  returning id into v_negocio_id;

  insert into public.negocio_miembros(negocio_id, user_id, rol, activo)
  values (v_negocio_id, new.id, 'owner', true);

  insert into public.sucursales(negocio_id, nombre, activa)
  values (v_negocio_id, 'Principal', true)
  returning id into v_sucursal_id;

  insert into public.cajas(negocio_id, sucursal_id, nombre, activa)
  values (v_negocio_id, v_sucursal_id, 'Caja 1', true);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_vendify on auth.users;
create trigger on_auth_user_created_vendify
after insert on auth.users
for each row execute procedure public.crear_entorno_nuevo_usuario();

-- Backfill defensivo para usuarios que pudieran haberse creado entre 001 y 003.
do $$
declare
  v_user record;
  v_negocio_id uuid;
  v_sucursal_id uuid;
begin
  for v_user in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where not exists (select 1 from public.negocio_miembros nm where nm.user_id=u.id)
  loop
    insert into public.negocios(nombre,email,plan,activo)
    values (
      coalesce(nullif(trim(coalesce(v_user.raw_user_meta_data->>'business_name','')),''), nullif(split_part(coalesce(v_user.email,''),'@',1),''), 'Mi negocio'),
      v_user.email,'starter',true
    ) returning id into v_negocio_id;
    insert into public.negocio_miembros(negocio_id,user_id,rol,activo) values(v_negocio_id,v_user.id,'owner',true);
    insert into public.sucursales(negocio_id,nombre,activa) values(v_negocio_id,'Principal',true) returning id into v_sucursal_id;
    insert into public.cajas(negocio_id,sucursal_id,nombre,activa) values(v_negocio_id,v_sucursal_id,'Caja 1',true);
  end loop;
end $$;

commit;
