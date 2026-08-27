-- ============================================================
-- Vendify v2.6
-- FIX CRÍTICO: empleados creados accidentalmente como owner
-- + permisos de UI/backend coherentes
--
-- Ejecutar DESPUÉS de 006.
-- ============================================================

begin;

-- ============================================================
-- 1. REPARAR TRIGGER DE NUEVOS USUARIOS
--
-- Las cuentas internas de empleados son creadas por Edge Function.
-- NO deben recibir negocio propio ni rol owner.
-- ============================================================

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
  v_inv public.equipo_invitaciones;
begin
  -- ----------------------------------------------------------
  -- EMPLEADOS INTERNOS
  -- ----------------------------------------------------------
  -- La Edge Function crear-empleado se ocupa inmediatamente
  -- después de crear auth.users de agregar negocio_miembros
  -- y empleados.
  --
  -- Es fundamental NO crear un negocio/owner acá.
  if lower(coalesce(new.raw_user_meta_data->>'vendify_employee','false')) = 'true'
     or lower(coalesce(new.email,'')) like '%@employees.vendify.internal'
  then
    return new;
  end if;

  -- ----------------------------------------------------------
  -- Compatibilidad con invitaciones antiguas v2.2
  -- ----------------------------------------------------------
  if new.email is not null then
    select *
      into v_inv
      from public.equipo_invitaciones
     where lower(email)=lower(new.email)
       and estado='pending'
     order by creado
     limit 1
     for update;

    if found then
      insert into public.negocio_miembros(negocio_id,user_id,rol,activo)
      values(v_inv.negocio_id,new.id,v_inv.rol,true)
      on conflict (negocio_id,user_id)
      do update set rol=excluded.rol, activo=true;

      update public.equipo_invitaciones
         set estado='accepted',
             aceptado=now(),
             actualizado=now()
       where id=v_inv.id;

      return new;
    end if;
  end if;

  if exists (
      select 1
      from public.negocio_miembros
      where user_id=new.id
  ) then
    return new;
  end if;

  -- ----------------------------------------------------------
  -- Nuevo propietario normal
  -- ----------------------------------------------------------
  v_nombre := nullif(
      trim(coalesce(new.raw_user_meta_data->>'business_name','')),
      ''
  );

  if v_nombre is null then
    v_nombre := coalesce(
        nullif(split_part(coalesce(new.email,''),'@',1),''),
        'Mi negocio'
    );
  end if;

  insert into public.negocios(nombre,email,plan,activo)
  values(v_nombre,new.email,'starter',true)
  returning id into v_negocio_id;

  insert into public.negocio_miembros(negocio_id,user_id,rol,activo)
  values(v_negocio_id,new.id,'owner',true);

  insert into public.sucursales(negocio_id,nombre,activa)
  values(v_negocio_id,'Principal',true)
  returning id into v_sucursal_id;

  insert into public.cajas(negocio_id,sucursal_id,nombre,activa)
  values(v_negocio_id,v_sucursal_id,'Caja 1',true);

  return new;
end;
$$;

-- ============================================================
-- 2. REPARAR EMPLEADOS YA AFECTADOS
--
-- Para cada registro en empleados:
-- su negocio correcto es empleados.negocio_id.
-- Eliminamos cualquier membresía que tenga en OTRO negocio.
-- Esto quita el owner accidental creado por el trigger viejo.
-- ============================================================

delete from public.negocio_miembros nm
using public.empleados e
where nm.user_id = e.user_id
  and nm.negocio_id <> e.negocio_id;

-- Eliminar negocios huérfanos que fueron creados automáticamente
-- para emails internos de empleados.
delete from public.negocios n
where lower(coalesce(n.email,'')) like '%@employees.vendify.internal'
  and not exists (
      select 1
      from public.negocio_miembros nm
      where nm.negocio_id = n.id
  );

-- ============================================================
-- 3. ASEGURAR QUE CADA EMPLEADO TENGA SOLO SU ROL REAL
--
-- No tocamos el rol válido que ya tenga dentro de su negocio.
-- Solo verificamos que no sea owner.
-- Si algún empleado siguiera siendo owner en SU negocio correcto,
-- lo degradamos a cashier para evitar escalada accidental.
-- Después el owner real puede elegir manager/admin desde Equipo.
-- ============================================================

update public.negocio_miembros nm
set rol = 'cashier'
from public.empleados e
where nm.user_id = e.user_id
  and nm.negocio_id = e.negocio_id
  and nm.rol = 'owner';

-- ============================================================
-- 4. obtener_contexto_app
-- Manager ahora puede abrir Config,
-- pero NO puede administrar Equipo.
-- ============================================================

create or replace function public.obtener_contexto_app()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_miembro public.negocio_miembros;
    v_negocio public.negocios;
    v_sucursal public.sucursales;
    v_caja public.cajas;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Sesión requerida';
    end if;

    -- Preferimos una membresía que coincida con empleados.negocio_id
    -- cuando se trata de un usuario interno.
    select nm.*
      into v_miembro
      from public.negocio_miembros nm
      left join public.empleados e
        on e.user_id = nm.user_id
       and e.negocio_id = nm.negocio_id
     where nm.user_id = v_user_id
       and nm.activo = true
     order by
       case when e.id is not null then 0 else 1 end,
       case nm.rol
         when 'owner' then 1
         when 'admin' then 2
         when 'manager' then 3
         when 'cashier' then 4
         else 5
       end,
       nm.creado
     limit 1;

    if not found then
        raise exception 'El usuario no pertenece a ningún negocio activo';
    end if;

    select *
      into v_negocio
      from public.negocios
     where id = v_miembro.negocio_id
       and activo = true;

    if not found then
        raise exception 'Negocio inexistente o inactivo';
    end if;

    select *
      into v_sucursal
      from public.sucursales
     where negocio_id = v_negocio.id
       and activa = true
     order by
       case when nombre = 'Principal' then 0 else 1 end,
       creado
     limit 1;

    if not found then
        raise exception 'El negocio no tiene una sucursal activa';
    end if;

    select *
      into v_caja
      from public.cajas
     where negocio_id = v_negocio.id
       and sucursal_id = v_sucursal.id
       and activa = true
     order by
       case when nombre = 'Caja 1' then 0 else 1 end,
       creado
     limit 1;

    if not found then
        raise exception 'La sucursal no tiene una caja activa';
    end if;

    return jsonb_build_object(
        'user', jsonb_build_object(
            'id', v_user_id
        ),
        'business', jsonb_build_object(
            'id', v_negocio.id,
            'nombre', v_negocio.nombre,
            'plan', v_negocio.plan,
            'activo', v_negocio.activo
        ),
        'membership', jsonb_build_object(
            'id', v_miembro.id,
            'role', v_miembro.rol,
            'activo', v_miembro.activo
        ),
        'branch', jsonb_build_object(
            'id', v_sucursal.id,
            'nombre', v_sucursal.nombre
        ),
        'cashRegister', jsonb_build_object(
            'id', v_caja.id,
            'nombre', v_caja.nombre
        ),
        'permissions',
        case v_miembro.rol
            when 'owner' then jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', true,
                'adjustStock', true,
                'viewCosts', true,
                'viewProfit', true,
                'viewReports', true,
                'manageEmployees', true,
                'manageBusiness', true
            )
            when 'admin' then jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', true,
                'adjustStock', true,
                'viewCosts', true,
                'viewProfit', true,
                'viewReports', true,
                'manageEmployees', true,
                'manageBusiness', true
            )
            when 'manager' then jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', true,
                'adjustStock', true,
                'viewCosts', true,
                'viewProfit', true,
                'viewReports', true,
                'manageEmployees', false,
                'manageBusiness', true
            )
            else jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', false,
                'adjustStock', false,
                'viewCosts', false,
                'viewProfit', false,
                'viewReports', false,
                'manageEmployees', false,
                'manageBusiness', false
            )
        end
    );
end;
$$;

revoke all on function public.obtener_contexto_app() from public;
grant execute on function public.obtener_contexto_app() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- COMPROBACIÓN RECOMENDADA
-- ============================================================
--
-- select
--   e.nombre,
--   e.username,
--   nm.rol,
--   nm.negocio_id
-- from public.empleados e
-- join public.negocio_miembros nm
--   on nm.user_id=e.user_id
--  and nm.negocio_id=e.negocio_id;
--
-- Ningún empleado debería aparecer como owner.
