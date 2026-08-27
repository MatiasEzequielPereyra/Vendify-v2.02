-- ============================================================
-- Ventas Kiosco v2.0
-- Migración 002 — Contexto de aplicación + permisos
-- Ejecutar DESPUÉS de 001_multiempresa_roles_sucursales_FIX.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Obtener contexto completo del usuario autenticado
-- ------------------------------------------------------------

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

    select nm.*
      into v_miembro
      from public.negocio_miembros nm
     where nm.user_id = v_user_id
       and nm.activo = true
     order by
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
                'manageBusiness', false
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


-- ------------------------------------------------------------
-- 2. Cambiar de sucursal de forma segura
-- El frontend puede pedir una sucursal determinada y recibir
-- su caja activa principal.
-- ------------------------------------------------------------

create or replace function public.obtener_contexto_sucursal(
    p_sucursal_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal public.sucursales;
    v_caja public.cajas;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select *
      into v_sucursal
      from public.sucursales
     where id = p_sucursal_id
       and negocio_id = v_negocio_id
       and activa = true;

    if not found then
        raise exception 'Sucursal inexistente o no autorizada';
    end if;

    select *
      into v_caja
      from public.cajas
     where negocio_id = v_negocio_id
       and sucursal_id = v_sucursal.id
       and activa = true
     order by creado
     limit 1;

    if not found then
        raise exception 'La sucursal no tiene una caja activa';
    end if;

    return jsonb_build_object(
        'branch', jsonb_build_object(
            'id', v_sucursal.id,
            'nombre', v_sucursal.nombre
        ),
        'cashRegister', jsonb_build_object(
            'id', v_caja.id,
            'nombre', v_caja.nombre
        )
    );
end;
$$;

revoke all on function public.obtener_contexto_sucursal(uuid) from public;
grant execute on function public.obtener_contexto_sucursal(uuid) to authenticated;


-- ------------------------------------------------------------
-- 3. Listar sucursales disponibles para el miembro actual
-- ------------------------------------------------------------

create or replace function public.listar_sucursales_app()
returns table (
    id uuid,
    nombre text,
    direccion text,
    activa boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select
        s.id,
        s.nombre,
        s.direccion,
        s.activa
    from public.sucursales s
    where s.negocio_id = public.negocio_actual_id()
      and s.activa = true
    order by
      case when s.nombre = 'Principal' then 0 else 1 end,
      s.nombre;
$$;

revoke all on function public.listar_sucursales_app() from public;
grant execute on function public.listar_sucursales_app() to authenticated;


-- ------------------------------------------------------------
-- 4. Ver miembros del negocio
-- Base para la futura pantalla Empleados.
-- ------------------------------------------------------------

create or replace function public.listar_miembros_negocio()
returns table (
    membership_id uuid,
    user_id uuid,
    rol text,
    activo boolean,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para consultar miembros';
    end if;

    return query
    select
        nm.id,
        nm.user_id,
        nm.rol,
        nm.activo,
        nm.creado
    from public.negocio_miembros nm
    where nm.negocio_id = v_negocio_id
    order by
        case nm.rol
          when 'owner' then 1
          when 'admin' then 2
          when 'manager' then 3
          else 4
        end,
        nm.creado;
end;
$$;

revoke all on function public.listar_miembros_negocio() from public;
grant execute on function public.listar_miembros_negocio() to authenticated;


commit;

-- ============================================================
-- PRUEBA
-- Iniciá sesión en la app y desde SQL no se puede simular auth.uid().
-- La verificación real se hará desde el navegador llamando:
--
-- supabaseClient.rpc("obtener_contexto_app")
-- ============================================================
