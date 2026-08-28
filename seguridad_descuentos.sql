-- ============================================================
-- Vendify — Seguridad de descuentos
--
-- 1) Cada Owner/Admin configura SU PROPIO PIN.
-- 2) El PIN se almacena hasheado con pgcrypto.
-- 3) Cualquier usuario puede solicitar una autorización ingresando
--    el PIN válido de un Owner/Admin del mismo negocio.
-- 4) La autorización queda ligada a:
--      - sucursal
--      - usuario vendedor
--      - subtotal exacto
--      - tipo de descuento
--      - valor exacto
--    y vence a los 3 minutos.
-- 5) Un trigger impide insertar una venta con descuento sin una
--    autorización válida. No depende solamente del frontend.
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. PIN personal en la membresía
-- ------------------------------------------------------------

alter table public.negocio_miembros
    add column if not exists pin_descuento_hash text,
    add column if not exists pin_descuento_actualizado timestamptz;

-- ------------------------------------------------------------
-- 2. Autorizaciones temporales
-- ------------------------------------------------------------

create table if not exists public.descuento_autorizaciones (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,

    solicitante_user_id uuid not null references auth.users(id) on delete cascade,
    autorizador_user_id uuid not null references auth.users(id) on delete restrict,

    subtotal numeric(14,2) not null check (subtotal >= 0),
    descuento_tipo text not null
        check (descuento_tipo in ('porcentaje','monto')),
    descuento_valor numeric(14,2) not null check (descuento_valor > 0),

    creado timestamptz not null default now(),
    expira_en timestamptz not null default (now() + interval '3 minutes'),
    usado_en timestamptz,
    venta_id uuid
);

create index if not exists descuento_autorizaciones_lookup_idx
on public.descuento_autorizaciones(
    negocio_id,
    sucursal_id,
    solicitante_user_id,
    expira_en desc
);

alter table public.descuento_autorizaciones enable row level security;

-- No damos SELECT/INSERT/UPDATE directos al navegador.
-- Todo pasa por funciones SECURITY DEFINER.

-- ------------------------------------------------------------
-- 3. Rate limit para PIN
-- ------------------------------------------------------------

create table if not exists public.descuento_pin_intentos (
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    intentos integer not null default 0,
    ventana_inicio timestamptz not null default now(),
    bloqueado_hasta timestamptz,
    actualizado timestamptz not null default now(),
    primary key (negocio_id, user_id)
);

alter table public.descuento_pin_intentos enable row level security;

-- ------------------------------------------------------------
-- 4. Trazabilidad en ventas
-- ------------------------------------------------------------

alter table public.ventas
    add column if not exists descuento_autorizado_por uuid
        references auth.users(id) on delete set null,
    add column if not exists descuento_autorizacion_id uuid
        references public.descuento_autorizaciones(id) on delete set null;

create index if not exists ventas_descuento_autorizado_idx
on public.ventas(descuento_autorizado_por)
where descuento_total > 0;

-- ------------------------------------------------------------
-- 5. Configurar / cambiar PIN propio
-- ------------------------------------------------------------

create or replace function public.configurar_pin_descuento_v1(
    p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_negocio_id uuid;
    v_rol text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
        return jsonb_build_object(
            'ok', false,
            'message', 'El PIN debe tener entre 4 y 8 números'
        );
    end if;

    v_negocio_id := public.negocio_actual_id();

    select nm.rol
      into v_rol
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    if coalesce(v_rol,'') not in ('owner','admin') then
        raise exception 'Solo Propietarios y Administradores pueden configurar un PIN';
    end if;

    update public.negocio_miembros
       set pin_descuento_hash = crypt(p_pin, gen_salt('bf', 8)),
           pin_descuento_actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = auth.uid()
       and activo = true;

    insert into public.audit_log(
        negocio_id,
        user_id,
        accion,
        entidad,
        entidad_id,
        detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'pin_descuento_actualizado',
        'negocio_miembros',
        (
          select nm.id
          from public.negocio_miembros nm
          where nm.negocio_id = v_negocio_id
            and nm.user_id = auth.uid()
          limit 1
        ),
        jsonb_build_object('rol', v_rol)
    );

    return jsonb_build_object(
        'ok', true,
        'configurado', true
    );
end;
$$;

revoke all on function public.configurar_pin_descuento_v1(text) from public;
grant execute on function public.configurar_pin_descuento_v1(text) to authenticated;

-- ------------------------------------------------------------
-- 6. Estado del PIN para Configuración
-- ------------------------------------------------------------

create or replace function public.estado_pin_descuento_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_rol text;
    v_configurado boolean := false;
    v_total integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select
        nm.rol,
        nm.pin_descuento_hash is not null
      into
        v_rol,
        v_configurado
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    select count(*)
      into v_total
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.activo = true
       and nm.rol in ('owner','admin')
       and nm.pin_descuento_hash is not null;

    return jsonb_build_object(
        'rol', v_rol,
        'puede_configurar', coalesce(v_rol,'') in ('owner','admin'),
        'configurado', coalesce(v_configurado,false),
        'autorizadores_configurados', v_total
    );
end;
$$;

revoke all on function public.estado_pin_descuento_v1() from public;
grant execute on function public.estado_pin_descuento_v1() to authenticated;

-- ------------------------------------------------------------
-- 7. Verificar PIN y crear autorización exacta
-- ------------------------------------------------------------

create or replace function public.autorizar_descuento_v1(
    p_pin text,
    p_sucursal_id uuid,
    p_subtotal numeric,
    p_descuento_tipo text,
    p_descuento_valor numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_negocio_id uuid;
    v_intentos public.descuento_pin_intentos;
    v_autorizador_user_id uuid;
    v_autorizador_rol text;
    v_autorizador_nombre text;
    v_auth public.descuento_autorizaciones;
    v_nuevo_intentos integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    if not exists (
        select 1
        from public.sucursales s
        where s.id = p_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    if p_subtotal is null or p_subtotal <= 0 then
        return jsonb_build_object('ok',false,'message','El carrito está vacío');
    end if;

    if p_descuento_tipo not in ('porcentaje','monto') then
        return jsonb_build_object('ok',false,'message','Tipo de descuento inválido');
    end if;

    if p_descuento_valor is null or p_descuento_valor <= 0 then
        return jsonb_build_object('ok',false,'message','Ingresá un descuento válido');
    end if;

    if p_descuento_tipo = 'porcentaje' and p_descuento_valor > 100 then
        return jsonb_build_object('ok',false,'message','El porcentaje no puede superar 100%');
    end if;

    if p_descuento_tipo = 'monto' and p_descuento_valor > p_subtotal then
        return jsonb_build_object('ok',false,'message','El descuento no puede superar el subtotal');
    end if;

    -- Crear/lockear estado de intentos.
    insert into public.descuento_pin_intentos(
        negocio_id,user_id,intentos,ventana_inicio,actualizado
    )
    values(
        v_negocio_id,auth.uid(),0,now(),now()
    )
    on conflict (negocio_id,user_id) do nothing;

    select *
      into v_intentos
      from public.descuento_pin_intentos dpi
     where dpi.negocio_id = v_negocio_id
       and dpi.user_id = auth.uid()
     for update;

    if v_intentos.bloqueado_hasta is not null
       and v_intentos.bloqueado_hasta > now() then
        return jsonb_build_object(
            'ok', false,
            'message',
            'Demasiados intentos. Esperá unos minutos antes de volver a probar.'
        );
    end if;

    if v_intentos.ventana_inicio < now() - interval '10 minutes' then
        update public.descuento_pin_intentos
           set intentos = 0,
               ventana_inicio = now(),
               bloqueado_hasta = null,
               actualizado = now()
         where negocio_id = v_negocio_id
           and user_id = auth.uid();

        v_intentos.intentos := 0;
    end if;

    if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
        return jsonb_build_object(
            'ok', false,
            'message', 'PIN inválido'
        );
    end if;

    select
        nm.user_id,
        nm.rol,
        coalesce(
            e.nombre,
            split_part(u.email,'@',1),
            case when nm.rol='owner' then 'Propietario' else 'Administrador' end
        )
      into
        v_autorizador_user_id,
        v_autorizador_rol,
        v_autorizador_nombre
      from public.negocio_miembros nm
      join auth.users u
        on u.id = nm.user_id
      left join public.empleados e
        on e.user_id = nm.user_id
       and e.negocio_id = nm.negocio_id
     where nm.negocio_id = v_negocio_id
       and nm.activo = true
       and nm.rol in ('owner','admin')
       and nm.pin_descuento_hash is not null
       and crypt(p_pin, nm.pin_descuento_hash) = nm.pin_descuento_hash
     order by
       case when nm.rol = 'owner' then 0 else 1 end,
       nm.creado
     limit 1;

    if v_autorizador_user_id is null then
        v_nuevo_intentos := coalesce(v_intentos.intentos,0) + 1;

        update public.descuento_pin_intentos
           set intentos = v_nuevo_intentos,
               bloqueado_hasta =
                   case
                     when v_nuevo_intentos >= 5
                     then now() + interval '5 minutes'
                     else null
                   end,
               actualizado = now()
         where negocio_id = v_negocio_id
           and user_id = auth.uid();

        return jsonb_build_object(
            'ok', false,
            'message',
            case
              when v_nuevo_intentos >= 5
              then 'PIN incorrecto. Se bloquearon nuevos intentos durante 5 minutos.'
              else 'PIN de administrador incorrecto.'
            end
        );
    end if;

    update public.descuento_pin_intentos
       set intentos = 0,
           ventana_inicio = now(),
           bloqueado_hasta = null,
           actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = auth.uid();

    -- Inutilizar autorizaciones anteriores no consumidas del mismo vendedor.
    update public.descuento_autorizaciones
       set expira_en = now()
     where negocio_id = v_negocio_id
       and sucursal_id = p_sucursal_id
       and solicitante_user_id = auth.uid()
       and usado_en is null
       and expira_en > now();

    insert into public.descuento_autorizaciones(
        negocio_id,
        sucursal_id,
        solicitante_user_id,
        autorizador_user_id,
        subtotal,
        descuento_tipo,
        descuento_valor,
        expira_en
    )
    values(
        v_negocio_id,
        p_sucursal_id,
        auth.uid(),
        v_autorizador_user_id,
        round(p_subtotal,2),
        p_descuento_tipo,
        round(p_descuento_valor,2),
        now() + interval '3 minutes'
    )
    returning * into v_auth;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'descuento_pin_validado',
        'descuento_autorizaciones',
        v_auth.id,
        jsonb_build_object(
            'autorizador_user_id',v_autorizador_user_id,
            'sucursal_id',p_sucursal_id,
            'subtotal',round(p_subtotal,2),
            'tipo',p_descuento_tipo,
            'valor',round(p_descuento_valor,2)
        )
    );

    return jsonb_build_object(
        'ok', true,
        'autorizacion_id', v_auth.id,
        'autorizador_user_id', v_autorizador_user_id,
        'autorizador_rol',
            case
              when v_autorizador_rol='owner' then 'Propietario'
              else 'Administrador'
            end,
        'autorizador_nombre', v_autorizador_nombre,
        'expira_segundos', 180
    );
end;
$$;

revoke all on function public.autorizar_descuento_v1(text,uuid,numeric,text,numeric) from public;
grant execute on function public.autorizar_descuento_v1(text,uuid,numeric,text,numeric) to authenticated;

-- ------------------------------------------------------------
-- 8. Trigger: una venta con descuento NO entra sin autorización
-- ------------------------------------------------------------

create or replace function public.validar_autorizacion_descuento_venta_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_auth public.descuento_autorizaciones;
begin
    if coalesce(new.descuento_total,0) <= 0 then
        new.descuento_autorizado_por := null;
        new.descuento_autorizacion_id := null;
        return new;
    end if;

    select da.*
      into v_auth
      from public.descuento_autorizaciones da
     where da.negocio_id = new.negocio_id
       and da.sucursal_id = new.sucursal_id
       and da.solicitante_user_id = auth.uid()
       and da.usado_en is null
       and da.expira_en > now()
       and da.descuento_tipo = new.descuento_tipo
       and abs(da.descuento_valor - coalesce(new.descuento_valor,0)) <= 0.001
       and abs(da.subtotal - coalesce(new.subtotal,0)) <= 0.01
     order by da.creado desc
     limit 1
     for update skip locked;

    if v_auth.id is null then
        raise exception
            'El descuento requiere un PIN válido de Propietario o Administrador';
    end if;

    update public.descuento_autorizaciones
       set usado_en = now(),
           venta_id = new.id
     where id = v_auth.id;

    new.descuento_autorizado_por := v_auth.autorizador_user_id;
    new.descuento_autorizacion_id := v_auth.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        new.negocio_id,
        auth.uid(),
        'descuento_aplicado',
        'ventas',
        new.id,
        jsonb_build_object(
            'autorizador_user_id',v_auth.autorizador_user_id,
            'autorizacion_id',v_auth.id,
            'subtotal',new.subtotal,
            'descuento_tipo',new.descuento_tipo,
            'descuento_valor',new.descuento_valor,
            'descuento_total',new.descuento_total
        )
    );

    return new;
end;
$$;

drop trigger if exists validar_autorizacion_descuento_venta_v1
on public.ventas;

create trigger validar_autorizacion_descuento_venta_v1
before insert on public.ventas
for each row
execute function public.validar_autorizacion_descuento_venta_v1();

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- Verificación
-- ============================================================
--
-- select
--   rol,
--   pin_descuento_hash is not null as pin_configurado
-- from public.negocio_miembros
-- where negocio_id = public.negocio_actual_id();
--
-- NUNCA consultes ni muestres pin_descuento_hash desde el frontend.
-- ============================================================
