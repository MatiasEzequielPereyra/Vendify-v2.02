-- ============================================================
-- Vendify v2.3 — Empleados con usuario + contraseña
-- Ejecutar DESPUÉS de 004.
-- ============================================================

begin;

-- 1) Código de acceso del negocio
alter table public.negocios
    add column if not exists codigo_acceso text;

create unique index if not exists negocios_codigo_acceso_unique_idx
    on public.negocios(lower(codigo_acceso))
    where codigo_acceso is not null;

-- Generar código para negocios existentes si falta.
update public.negocios
set codigo_acceso = upper(
    regexp_replace(
        coalesce(nullif(slug,''), substring(id::text,1,8)),
        '[^a-zA-Z0-9]',
        '',
        'g'
    )
)
where codigo_acceso is null;

-- 2) Perfil de empleado
create table if not exists public.empleados (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    username text not null,
    nombre text not null,
    debe_cambiar_password boolean not null default true,
    activo boolean not null default true,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (negocio_id, user_id)
);

create unique index if not exists empleados_username_negocio_unique_idx
    on public.empleados(negocio_id, lower(username));

create index if not exists empleados_user_idx
    on public.empleados(user_id);

alter table public.empleados enable row level security;

drop policy if exists "empleados_self_select" on public.empleados;
create policy "empleados_self_select"
on public.empleados
for select
using (
    user_id = auth.uid()
    or public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin']
    )
);

-- Escritura directa bloqueada; se hace por RPC / Edge Function.

-- 3) Contexto del empleado autenticado
create or replace function public.obtener_perfil_empleado_actual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_emp public.empleados;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    select *
      into v_emp
      from public.empleados
     where user_id = auth.uid()
       and activo = true
     limit 1;

    if not found then
        return null;
    end if;

    return jsonb_build_object(
        'id', v_emp.id,
        'username', v_emp.username,
        'nombre', v_emp.nombre,
        'debe_cambiar_password', v_emp.debe_cambiar_password,
        'activo', v_emp.activo
    );
end;
$$;

revoke all on function public.obtener_perfil_empleado_actual() from public;
grant execute on function public.obtener_perfil_empleado_actual() to authenticated;

-- 4) Marcar contraseña cambiada
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
     where user_id = auth.uid()
       and activo = true;

    return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.marcar_password_empleado_cambiada() from public;
grant execute on function public.marcar_password_empleado_cambiada() to authenticated;

-- 5) Listado v2.3 de equipo
create or replace function public.listar_equipo_v3()
returns table (
    membership_id uuid,
    user_id uuid,
    email text,
    username text,
    nombre text,
    rol text,
    activo boolean,
    debe_cambiar_password boolean,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
    v_negocio_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para administrar el equipo';
    end if;

    return query
    select
        nm.id,
        nm.user_id,
        u.email::text,
        e.username,
        coalesce(e.nombre, split_part(u.email,'@',1))::text,
        nm.rol,
        nm.activo,
        coalesce(e.debe_cambiar_password,false),
        nm.creado
    from public.negocio_miembros nm
    join auth.users u on u.id = nm.user_id
    left join public.empleados e
      on e.user_id = nm.user_id
     and e.negocio_id = nm.negocio_id
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

revoke all on function public.listar_equipo_v3() from public;
grant execute on function public.listar_equipo_v3() to authenticated;

-- 6) Desactivar/activar también sincroniza perfil empleado
create or replace function public.cambiar_estado_miembro_v3(
    p_membership_id uuid,
    p_activo boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para cambiar el estado de empleados';
    end if;

    select *
      into v_target
      from public.negocio_miembros
     where id = p_membership_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Miembro inexistente';
    end if;

    if v_target.rol = 'owner' then
        raise exception 'El propietario no puede desactivarse';
    end if;

    if v_target.user_id = auth.uid() then
        raise exception 'No podés desactivar tu propio usuario';
    end if;

    update public.negocio_miembros
       set activo = p_activo
     where id = p_membership_id;

    update public.empleados
       set activo = p_activo,
           actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = v_target.user_id;

    return jsonb_build_object('ok',true,'activo',p_activo);
end;
$$;

revoke all on function public.cambiar_estado_miembro_v3(uuid,boolean) from public;
grant execute on function public.cambiar_estado_miembro_v3(uuid,boolean) to authenticated;

-- 7) Helper: negocio y código para Edge Function
create or replace function public.obtener_negocio_admin_actual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio public.negocios;
begin
    select n.*
      into v_negocio
      from public.negocios n
      join public.negocio_miembros nm on nm.negocio_id = n.id
     where nm.user_id = auth.uid()
       and nm.activo = true
       and nm.rol in ('owner','admin')
     order by case nm.rol when 'owner' then 1 else 2 end
     limit 1;

    if not found then
        raise exception 'No autorizado';
    end if;

    return jsonb_build_object(
        'id', v_negocio.id,
        'nombre', v_negocio.nombre,
        'codigo_acceso', v_negocio.codigo_acceso
    );
end;
$$;

revoke all on function public.obtener_negocio_admin_actual() from public;
grant execute on function public.obtener_negocio_admin_actual() to authenticated;

-- 8) Ya no usamos invitaciones para empleados nuevos.
-- Dejamos tabla anterior para histórico, pero no se usa en v2.3.

notify pgrst, 'reload schema';

commit;
