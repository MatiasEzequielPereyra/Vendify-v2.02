-- ============================================================
-- VENDIFY v2.31 — COMMERCIAL FOUNDATION
-- Requiere migraciones hasta v2.30.1.4.
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 1. CONFIGURACIÓN OPERATIVA
-- ============================================================

create table if not exists public.vendify_config_operativa (
    negocio_id uuid primary key references public.negocios(id) on delete cascade,
    stock_cobertura_alerta integer not null default 3
        check (stock_cobertura_alerta between 1 and 30),
    ajuste_grande_unidades integer not null default 10
        check (ajuste_grande_unidades between 1 and 10000),
    diferencia_caja_alerta numeric(14,2) not null default 10000
        check (diferencia_caja_alerta >= 0),
    resumen_diario boolean not null default true,
    auto_imprimir_ticket boolean not null default false,
    ancho_ticket_mm integer not null default 80
        check (ancho_ticket_mm in (58,80)),
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

alter table public.vendify_config_operativa enable row level security;
revoke all on table public.vendify_config_operativa from anon, authenticated;

insert into public.vendify_config_operativa(negocio_id)
select n.id
from public.negocios n
on conflict (negocio_id) do nothing;

create or replace function public.vendify_crear_config_operativa_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.vendify_config_operativa(negocio_id)
    values(new.id)
    on conflict (negocio_id) do nothing;
    return new;
end;
$$;

drop trigger if exists vendify_config_operativa_on_negocio on public.negocios;
create trigger vendify_config_operativa_on_negocio
after insert on public.negocios
for each row
execute function public.vendify_crear_config_operativa_trigger_v1();

create or replace function public.obtener_config_operativa_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_row public.vendify_config_operativa;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    insert into public.vendify_config_operativa(negocio_id)
    values(v_negocio_id)
    on conflict (negocio_id) do nothing;

    select *
      into v_row
      from public.vendify_config_operativa
     where negocio_id = v_negocio_id;

    return to_jsonb(v_row)
      - 'negocio_id'
      - 'creado'
      - 'actualizado';
end;
$$;

revoke all on function public.obtener_config_operativa_v1() from public;
grant execute on function public.obtener_config_operativa_v1() to authenticated;

create or replace function public.guardar_config_operativa_v1(
    p_stock_cobertura_alerta integer,
    p_ajuste_grande_unidades integer,
    p_diferencia_caja_alerta numeric,
    p_resumen_diario boolean,
    p_auto_imprimir_ticket boolean,
    p_ancho_ticket_mm integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'Solo Propietario o Administrador pueden modificar esta configuración';
    end if;

    insert into public.vendify_config_operativa(
        negocio_id,
        stock_cobertura_alerta,
        ajuste_grande_unidades,
        diferencia_caja_alerta,
        resumen_diario,
        auto_imprimir_ticket,
        ancho_ticket_mm,
        actualizado
    )
    values(
        v_negocio_id,
        greatest(1,least(coalesce(p_stock_cobertura_alerta,3),30)),
        greatest(1,least(coalesce(p_ajuste_grande_unidades,10),10000)),
        greatest(0,coalesce(p_diferencia_caja_alerta,10000)),
        coalesce(p_resumen_diario,true),
        coalesce(p_auto_imprimir_ticket,false),
        case when p_ancho_ticket_mm = 58 then 58 else 80 end,
        now()
    )
    on conflict (negocio_id) do update
    set stock_cobertura_alerta = excluded.stock_cobertura_alerta,
        ajuste_grande_unidades = excluded.ajuste_grande_unidades,
        diferencia_caja_alerta = excluded.diferencia_caja_alerta,
        resumen_diario = excluded.resumen_diario,
        auto_imprimir_ticket = excluded.auto_imprimir_ticket,
        ancho_ticket_mm = excluded.ancho_ticket_mm,
        actualizado = now();

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'config_operativa_actualizada',
        'vendify_config_operativa',
        v_negocio_id,
        jsonb_build_object(
            'stock_cobertura_alerta',p_stock_cobertura_alerta,
            'ajuste_grande_unidades',p_ajuste_grande_unidades,
            'diferencia_caja_alerta',p_diferencia_caja_alerta,
            'resumen_diario',p_resumen_diario,
            'auto_imprimir_ticket',p_auto_imprimir_ticket,
            'ancho_ticket_mm',p_ancho_ticket_mm
        )
    );

    return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.guardar_config_operativa_v1(
    integer,integer,numeric,boolean,boolean,integer
) from public;

grant execute on function public.guardar_config_operativa_v1(
    integer,integer,numeric,boolean,boolean,integer
) to authenticated;

-- ============================================================
-- 2. PLANES / TRIAL / LÍMITES
-- ============================================================

create table if not exists public.vendify_planes (
    codigo text primary key,
    nombre text not null,
    max_sucursales integer,
    max_usuarios integer,
    max_productos integer,
    trial_dias integer,
    activo boolean not null default true,
    orden integer not null default 0
);

insert into public.vendify_planes(
    codigo,nombre,max_sucursales,max_usuarios,max_productos,trial_dias,orden
)
values
    ('legacy','Legacy',null,null,null,null,0),
    ('trial','Prueba Pro',1,3,500,14,10),
    ('starter','Starter',1,3,1000,null,20),
    ('pro','Pro',3,10,5000,null,30),
    ('business','Business',null,null,null,null,40)
on conflict (codigo) do update
set nombre = excluded.nombre,
    max_sucursales = excluded.max_sucursales,
    max_usuarios = excluded.max_usuarios,
    max_productos = excluded.max_productos,
    trial_dias = excluded.trial_dias,
    orden = excluded.orden;

create table if not exists public.vendify_suscripciones (
    negocio_id uuid primary key references public.negocios(id) on delete cascade,
    plan_codigo text not null references public.vendify_planes(codigo),
    estado text not null default 'activo'
        check (estado in ('activo','trial','vencido','suspendido','legacy')),
    trial_hasta timestamptz,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

alter table public.vendify_planes enable row level security;
alter table public.vendify_suscripciones enable row level security;
revoke all on table public.vendify_planes from anon, authenticated;
revoke all on table public.vendify_suscripciones from anon, authenticated;

-- Instalaciones existentes: Legacy sin límites.
insert into public.vendify_suscripciones(
    negocio_id,plan_codigo,estado
)
select n.id,'legacy','legacy'
from public.negocios n
on conflict (negocio_id) do nothing;

create or replace function public.vendify_trial_nuevo_negocio_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.vendify_suscripciones(
        negocio_id,plan_codigo,estado,trial_hasta
    )
    values(
        new.id,
        'trial',
        'trial',
        now() + interval '14 days'
    )
    on conflict (negocio_id) do nothing;

    return new;
end;
$$;

drop trigger if exists vendify_trial_nuevo_negocio on public.negocios;
create trigger vendify_trial_nuevo_negocio
after insert on public.negocios
for each row
execute function public.vendify_trial_nuevo_negocio_trigger_v1();

create or replace function public.obtener_plan_actual_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sub public.vendify_suscripciones;
    v_plan public.vendify_planes;
    v_sucursales integer;
    v_usuarios integer;
    v_productos integer;
    v_trial_dias integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    select *
      into v_sub
      from public.vendify_suscripciones
     where negocio_id = v_negocio_id;

    if v_sub.negocio_id is null then
        insert into public.vendify_suscripciones(
            negocio_id,plan_codigo,estado
        )
        values(v_negocio_id,'legacy','legacy')
        returning * into v_sub;
    end if;

    select *
      into v_plan
      from public.vendify_planes
     where codigo = v_sub.plan_codigo;

    select count(*) into v_sucursales
      from public.sucursales s
     where s.negocio_id = v_negocio_id
       and s.activa = true;

    select count(*) into v_usuarios
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.activo = true;

    select count(*) into v_productos
      from public.productos p
     where p.negocio_id = v_negocio_id;

    v_trial_dias :=
      case
        when v_sub.trial_hasta is null then null
        else greatest(
            0,
            ceil(
              extract(epoch from (v_sub.trial_hasta - now()))
              / 86400.0
            )::integer
        )
      end;

    return jsonb_build_object(
        'codigo',v_plan.codigo,
        'nombre',v_plan.nombre,
        'estado',v_sub.estado,
        'trial_hasta',v_sub.trial_hasta,
        'trial_dias_restantes',v_trial_dias,
        'limites',jsonb_build_object(
            'sucursales',v_plan.max_sucursales,
            'usuarios',v_plan.max_usuarios,
            'productos',v_plan.max_productos
        ),
        'uso',jsonb_build_object(
            'sucursales',v_sucursales,
            'usuarios',v_usuarios,
            'productos',v_productos
        )
    );
end;
$$;

revoke all on function public.obtener_plan_actual_v1() from public;
grant execute on function public.obtener_plan_actual_v1() to authenticated;

create or replace function public.validar_limite_plan_v1(
    p_negocio_id uuid,
    p_recurso text,
    p_incremento integer default 1
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_plan public.vendify_planes;
    v_sub public.vendify_suscripciones;
    v_actual integer;
    v_limite integer;
begin
    select *
      into v_sub
      from public.vendify_suscripciones
     where negocio_id = p_negocio_id;

    if v_sub.negocio_id is null
       or v_sub.plan_codigo = 'legacy' then
        return true;
    end if;

    if v_sub.estado = 'trial'
       and v_sub.trial_hasta is not null
       and v_sub.trial_hasta < now() then
        raise exception 'La prueba de Vendify venció. Elegí un plan para continuar.';
    end if;

    select *
      into v_plan
      from public.vendify_planes
     where codigo = v_sub.plan_codigo;

    if p_recurso = 'sucursales' then
        v_limite := v_plan.max_sucursales;
        select count(*) into v_actual
          from public.sucursales s
         where s.negocio_id = p_negocio_id
           and s.activa = true;
    elsif p_recurso = 'usuarios' then
        v_limite := v_plan.max_usuarios;
        select count(*) into v_actual
          from public.negocio_miembros nm
         where nm.negocio_id = p_negocio_id
           and nm.activo = true;
    elsif p_recurso = 'productos' then
        v_limite := v_plan.max_productos;
        select count(*) into v_actual
          from public.productos p
         where p.negocio_id = p_negocio_id;
    else
        return true;
    end if;

    if v_limite is null then
        return true;
    end if;

    if v_actual + greatest(0,coalesce(p_incremento,1)) > v_limite then
        raise exception
          'Límite del plan alcanzado para % (% de %)',
          p_recurso,v_actual,v_limite;
    end if;

    return true;
end;
$$;

revoke all on function public.validar_limite_plan_v1(
    uuid,text,integer
) from public;

grant execute on function public.validar_limite_plan_v1(
    uuid,text,integer
) to authenticated;

create or replace function public.vendify_limite_productos_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.validar_limite_plan_v1(
        new.negocio_id,'productos',1
    );
    return new;
end;
$$;

drop trigger if exists vendify_limite_productos on public.productos;
create trigger vendify_limite_productos
before insert on public.productos
for each row
execute function public.vendify_limite_productos_trigger_v1();

create or replace function public.vendify_limite_sucursales_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(new.activa,true) = true then
        perform public.validar_limite_plan_v1(
            new.negocio_id,'sucursales',1
        );
    end if;
    return new;
end;
$$;

drop trigger if exists vendify_limite_sucursales on public.sucursales;
create trigger vendify_limite_sucursales
before insert on public.sucursales
for each row
execute function public.vendify_limite_sucursales_trigger_v1();

create or replace function public.vendify_limite_usuarios_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(new.activo,true) = true then
        perform public.validar_limite_plan_v1(
            new.negocio_id,'usuarios',1
        );
    end if;
    return new;
end;
$$;

drop trigger if exists vendify_limite_usuarios on public.negocio_miembros;
create trigger vendify_limite_usuarios
before insert on public.negocio_miembros
for each row
execute function public.vendify_limite_usuarios_trigger_v1();

-- ============================================================
-- 3. OBSERVABILIDAD
-- ============================================================

create table if not exists public.vendify_error_logs (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid references public.sucursales(id) on delete set null,
    user_id uuid references auth.users(id) on delete set null,
    tipo text not null,
    mensaje text not null,
    version text,
    contexto jsonb not null default '{}'::jsonb,
    creado timestamptz not null default now()
);

create index if not exists vendify_error_logs_negocio_fecha_idx
    on public.vendify_error_logs(negocio_id,creado desc);

alter table public.vendify_error_logs enable row level security;
revoke all on table public.vendify_error_logs from anon, authenticated;

create or replace function public.registrar_error_cliente_v1(
    p_tipo text,
    p_mensaje text,
    p_version text default null,
    p_contexto jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal_id uuid;
begin
    if auth.uid() is null then
        return;
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        return;
    end if;

    begin
        v_sucursal_id :=
          nullif(coalesce(p_contexto->>'branch_id',''),'')::uuid;
    exception
        when others then
          v_sucursal_id := null;
    end;

    insert into public.vendify_error_logs(
        negocio_id,sucursal_id,user_id,tipo,mensaje,version,contexto
    )
    values(
        v_negocio_id,
        v_sucursal_id,
        auth.uid(),
        left(coalesce(nullif(trim(p_tipo),''),'client'),50),
        left(coalesce(nullif(trim(p_mensaje),''),'Error cliente'),1000),
        left(coalesce(p_version,''),30),
        coalesce(p_contexto,'{}'::jsonb)
    );
end;
$$;

revoke all on function public.registrar_error_cliente_v1(
    text,text,text,jsonb
) from public;

grant execute on function public.registrar_error_cliente_v1(
    text,text,text,jsonb
) to authenticated;

-- ============================================================
-- 4. ONBOARDING COMERCIAL
-- ============================================================

create or replace function public.estado_onboarding_comercial_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_productos integer;
    v_ventas integer;
    v_miembros integer;
    v_caja_utilizada boolean := false;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    select count(*) into v_productos
      from public.productos p
     where p.negocio_id = v_negocio_id;

    select count(*) into v_ventas
      from public.ventas v
     where v.negocio_id = v_negocio_id;

    select count(*) into v_miembros
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.activo = true;

    if to_regclass('public.cajas_sesiones') is not null then
        execute
          'select exists(
             select 1
             from public.cajas_sesiones cs
             where to_jsonb(cs)->>''negocio_id'' = $1
           )'
        into v_caja_utilizada
        using v_negocio_id::text;
    end if;

    return jsonb_build_object(
        'productos',v_productos,
        'ventas',v_ventas,
        'miembros',v_miembros,
        'caja_utilizada',v_caja_utilizada,
        'completado',
          v_productos > 0
          and v_ventas > 0
          and v_miembros > 1
          and v_caja_utilizada
    );
end;
$$;

revoke all on function public.estado_onboarding_comercial_v1()
from public;

grant execute on function public.estado_onboarding_comercial_v1()
to authenticated;


-- ============================================================
-- 5. ALERTAS, ACTIVIDAD Y REPOSICIÓN
-- ============================================================

create or replace function public.recomendaciones_reposicion_v1(
    p_sucursal_id uuid,
    p_limit integer default 8
)
returns table (
    producto_id uuid,
    nombre text,
    stock integer,
    dias_cobertura numeric,
    reposicion_sugerida integer,
    estado text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para ver recomendaciones';
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

    return query
    select
        s.producto_id,
        p.nombre::text,
        s.stock::integer,
        s.dias_cobertura::numeric,
        greatest(
            0,
            coalesce(s.reposicion_sugerida_7d,0)
        )::integer,
        coalesce(s.estado,'sin_datos')::text
    from public.obtener_stock_inteligente_sucursal(
        p_sucursal_id
    ) s
    join public.productos p
      on p.id = s.producto_id
     and p.negocio_id = v_negocio_id
    where
        greatest(
            0,
            coalesce(s.reposicion_sugerida_7d,0)
        ) > 0
        or coalesce(s.estado,'') in (
            'bajo',
            'sin_stock',
            'proximo'
        )
    order by
        case
          when s.stock <= 0 then 0
          else 1
        end,
        coalesce(s.dias_cobertura,999999),
        greatest(
            0,
            coalesce(s.reposicion_sugerida_7d,0)
        ) desc,
        p.nombre
    limit greatest(
        1,
        least(coalesce(p_limit,8),50)
    );
end;
$$;

revoke all on function public.recomendaciones_reposicion_v1(
    uuid,integer
) from public;

grant execute on function public.recomendaciones_reposicion_v1(
    uuid,integer
) to authenticated;


create or replace function public.alertas_operativas_v1(
    p_sucursal_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal_id uuid;
    v_cfg public.vendify_config_operativa;

    v_zero integer := 0;
    v_low integer := 0;
    v_big_adjust integer := 0;
    v_refunds integer := 0;
    v_cash_diff integer := 0;

    v_alerts jsonb := '[]'::jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para ver alertas';
    end if;

    select *
      into v_cfg
      from public.vendify_config_operativa
     where negocio_id = v_negocio_id;

    select coalesce(
        p_sucursal_id,
        (
          select s.id
          from public.sucursales s
          where s.negocio_id = v_negocio_id
            and s.activa = true
          order by s.creado
          limit 1
        )
    )
    into v_sucursal_id;

    if v_sucursal_id is null then
        return '[]'::jsonb;
    end if;

    if not exists (
        select 1
        from public.sucursales s
        where s.id = v_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    select count(*)
      into v_zero
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = v_sucursal_id
       and ps.stock <= 0;

    select count(*)
      into v_low
      from public.obtener_stock_inteligente_sucursal(
          v_sucursal_id
      ) s
     where
        coalesce(s.estado,'') = 'bajo'
        or (
          s.dias_cobertura is not null
          and s.dias_cobertura <=
              coalesce(
                  v_cfg.stock_cobertura_alerta,
                  3
              )
        );

    select count(*)
      into v_big_adjust
      from public.movimientos m
     where m.negocio_id = v_negocio_id
       and m.sucursal_id = v_sucursal_id
       and m.creado >= now() - interval '24 hours'
       and m.tipo in (
           'ajuste',
           'rotura',
           'vencimiento',
           'perdida',
           'inventario'
       )
       and abs(coalesce(m.delta,0)) >=
           coalesce(
               v_cfg.ajuste_grande_unidades,
               10
           );

    select count(*)
      into v_refunds
      from public.ventas v
     where v.negocio_id = v_negocio_id
       and v.sucursal_id = v_sucursal_id
       and v.creado >= now() - interval '24 hours'
       and (
          coalesce(v.total_devuelto,0) > 0
          or v.estado in (
              'devuelta',
              'parcialmente_devuelta',
              'anulada'
          )
       );

    -- Se usa to_jsonb para tolerar instalaciones históricas
    -- con pequeñas diferencias de nombres en cajas_sesiones.
    if to_regclass(
        'public.cajas_sesiones'
    ) is not null then
        execute
          'select count(*)
             from public.cajas_sesiones cs
            where to_jsonb(cs)->>''negocio_id'' = $1
              and ($2 is null
                   or to_jsonb(cs)->>''sucursal_id'' = $2)
              and coalesce(
                    abs(
                      nullif(
                        to_jsonb(cs)->>''diferencia'',
                        ''''
                      )::numeric
                    ),
                    0
                  ) >= $3
              and coalesce(
                    nullif(
                      to_jsonb(cs)->>''cerrada_en'',
                      ''''
                    )::timestamptz,
                    now() - interval ''100 years''
                  ) >= now() - interval ''7 days'''
        into v_cash_diff
        using
          v_negocio_id::text,
          v_sucursal_id::text,
          coalesce(
              v_cfg.diferencia_caja_alerta,
              10000
          );
    end if;

    if v_zero > 0 then
        v_alerts :=
          v_alerts ||
          jsonb_build_array(
            jsonb_build_object(
              'severity','critical',
              'code','stock_zero',
              'title','Productos sin stock',
              'detail',
                'Hay productos que ya no tienen unidades disponibles.',
              'count',v_zero
            )
          );
    end if;

    if v_low > 0 then
        v_alerts :=
          v_alerts ||
          jsonb_build_array(
            jsonb_build_object(
              'severity','warning',
              'code','stock_low',
              'title','Reposición próxima',
              'detail',
                'El ritmo de venta indica que conviene reponer mercadería.',
              'count',v_low
            )
          );
    end if;

    if v_big_adjust > 0 then
        v_alerts :=
          v_alerts ||
          jsonb_build_array(
            jsonb_build_object(
              'severity','warning',
              'code','big_adjust',
              'title','Ajustes grandes de stock',
              'detail',
                'Se detectaron ajustes manuales importantes en las últimas 24 horas.',
              'count',v_big_adjust
            )
          );
    end if;

    if v_cash_diff > 0 then
        v_alerts :=
          v_alerts ||
          jsonb_build_array(
            jsonb_build_object(
              'severity','critical',
              'code','cash_difference',
              'title','Diferencias de caja',
              'detail',
                'Hay cierres recientes por encima del umbral configurado.',
              'count',v_cash_diff
            )
          );
    end if;

    if v_refunds > 0 then
        v_alerts :=
          v_alerts ||
          jsonb_build_array(
            jsonb_build_object(
              'severity','info',
              'code','refunds',
              'title','Devoluciones o anulaciones',
              'detail',
                'Hubo operaciones revertidas durante las últimas 24 horas.',
              'count',v_refunds
            )
          );
    end if;

    return v_alerts;
end;
$$;

revoke all on function public.alertas_operativas_v1(
    uuid
) from public;

grant execute on function public.alertas_operativas_v1(
    uuid
) to authenticated;


create or replace function public.actividad_propietario_v1(
    p_sucursal_id uuid default null,
    p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_result jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para ver actividad';
    end if;

    select coalesce(
        jsonb_agg(
            x.obj
            order by x.fecha desc
        ),
        '[]'::jsonb
    )
    into v_result
    from (
      select *
      from (
        select
          m.creado as fecha,
          jsonb_build_object(
            'fecha',m.creado,
            'icon','inventory',
            'title',
              coalesce(
                nullif(m.producto_nombre,''),
                'Movimiento de stock'
              ),
            'detail',
              coalesce(
                nullif(m.motivo,''),
                initcap(
                  replace(m.tipo,'_',' ')
                )
              )
              ||
              case
                when m.delta > 0
                  then ' · +' || m.delta::text
                else ' · ' || m.delta::text
              end
          ) as obj
        from public.movimientos m
        where m.negocio_id = v_negocio_id
          and (
            p_sucursal_id is null
            or m.sucursal_id = p_sucursal_id
          )

        union all

        select
          v.creado as fecha,
          jsonb_build_object(
            'fecha',v.creado,
            'icon','receipt',
            'title',
              'Venta #' ||
              upper(
                left(
                  replace(v.id::text,'-',''),
                  8
                )
              ),
            'detail',
              case
                when v.estado = 'anulada'
                  then 'Anulada · '
                when coalesce(v.total_devuelto,0) > 0
                  then 'Con devolución · '
                else 'Venta · '
              end
              ||
              '$' ||
              trim(
                to_char(
                  greatest(
                    0,
                    coalesce(v.total,0)
                    - coalesce(v.total_devuelto,0)
                  ),
                  'FM999G999G999G990D00'
                )
              )
          ) as obj
        from public.ventas v
        where v.negocio_id = v_negocio_id
          and (
            p_sucursal_id is null
            or v.sucursal_id = p_sucursal_id
          )

        union all

        select
          c.creado as fecha,
          jsonb_build_object(
            'fecha',c.creado,
            'icon','purchases',
            'title',
              'Compra' ||
              case
                when nullif(
                    trim(
                      coalesce(
                        c.numero_comprobante,
                        ''
                      )
                    ),
                    ''
                ) is null
                  then ''
                else ' · ' || c.numero_comprobante
              end,
            'detail',
              initcap(c.estado)
              || ' · $'
              || trim(
                  to_char(
                    coalesce(c.total,0),
                    'FM999G999G999G990D00'
                  )
              )
          ) as obj
        from public.compras c
        where c.negocio_id = v_negocio_id
          and (
            p_sucursal_id is null
            or c.sucursal_id = p_sucursal_id
          )
      ) all_activity
      order by fecha desc
      limit greatest(
          1,
          least(coalesce(p_limit,12),50)
      )
    ) x;

    return coalesce(
        v_result,
        '[]'::jsonb
    );
end;
$$;

revoke all on function public.actividad_propietario_v1(
    uuid,integer
) from public;

grant execute on function public.actividad_propietario_v1(
    uuid,integer
) to authenticated;


-- ============================================================
-- 6. DASHBOARD DEL PROPIETARIO
-- ============================================================

create or replace function public.dashboard_propietario_v1(
    p_sucursal_id uuid default null,
    p_dias integer default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal_id uuid;
    v_dias integer;

    v_desde timestamptz;
    v_anterior_desde timestamptz;
    v_anterior_hasta timestamptz;

    v_total numeric := 0;
    v_total_prev numeric := 0;
    v_tickets integer := 0;
    v_margin numeric := 0;
    v_refunds numeric := 0;
    v_refund_count integer := 0;
    v_cash_open integer := 0;
    v_variacion numeric;

    v_series jsonb := '[]'::jsonb;
    v_top jsonb := '[]'::jsonb;
    v_payments jsonb := '[]'::jsonb;
    v_restock jsonb := '[]'::jsonb;
    v_alerts jsonb := '[]'::jsonb;
    v_activity jsonb := '[]'::jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para acceder al Dashboard';
    end if;

    v_dias :=
      greatest(
        1,
        least(coalesce(p_dias,7),365)
      );

    v_desde :=
      date_trunc('day',now())
      - ((v_dias - 1) || ' days')::interval;

    v_anterior_hasta := v_desde;
    v_anterior_desde :=
      v_desde - (v_dias || ' days')::interval;

    select coalesce(
      p_sucursal_id,
      (
        select s.id
        from public.sucursales s
        where s.negocio_id = v_negocio_id
          and s.activa = true
        order by s.creado
        limit 1
      )
    )
    into v_sucursal_id;

    if v_sucursal_id is null then
        raise exception 'El negocio no tiene una sucursal activa';
    end if;

    if not exists (
        select 1
        from public.sucursales s
        where s.id = v_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    -- Ventas netas, tickets y devoluciones.
    select
      coalesce(
        sum(
          greatest(
            0,
            coalesce(v.total,0)
            - coalesce(v.total_devuelto,0)
          )
        ),
        0
      ),
      count(*) filter (
        where v.estado <> 'anulada'
      ),
      coalesce(
        sum(
          coalesce(v.total_devuelto,0)
        ),
        0
      ),
      count(*) filter (
        where
          coalesce(v.total_devuelto,0) > 0
          or v.estado in (
              'devuelta',
              'parcialmente_devuelta',
              'anulada'
          )
      )
    into
      v_total,
      v_tickets,
      v_refunds,
      v_refund_count
    from public.ventas v
    where v.negocio_id = v_negocio_id
      and v.sucursal_id = v_sucursal_id
      and v.creado >= v_desde;

    -- Período anterior equivalente.
    select
      coalesce(
        sum(
          greatest(
            0,
            coalesce(v.total,0)
            - coalesce(v.total_devuelto,0)
          )
        ),
        0
      )
    into v_total_prev
    from public.ventas v
    where v.negocio_id = v_negocio_id
      and v.sucursal_id = v_sucursal_id
      and v.creado >= v_anterior_desde
      and v.creado < v_anterior_hasta;

    v_variacion :=
      case
        when v_total_prev <= 0
          then null
        else round(
          (
            (v_total - v_total_prev)
            / v_total_prev
          ) * 100,
          1
        )
      end;

    -- Margen estimado:
    -- precio neto histórico - costo ACTUAL del catálogo.
    -- Se documenta como estimación, no como margen contable.
    select coalesce(
      sum(
        case
          when v.estado = 'anulada'
            then 0
          else
            greatest(
              0,
              coalesce(
                vi.precio_neto_unitario,
                vi.precio_unitario,
                0
              )
              - coalesce(p.precio_compra,0)
            )
            *
            greatest(
              0,
              coalesce(vi.cantidad,0)
              - coalesce(vi.cantidad_devuelta,0)
            )
        end
      ),
      0
    )
    into v_margin
    from public.venta_items vi
    join public.ventas v
      on v.id = vi.venta_id
     and v.negocio_id = v_negocio_id
    left join public.productos p
      on p.id = vi.producto_id
     and p.negocio_id = v_negocio_id
    where v.sucursal_id = v_sucursal_id
      and v.creado >= v_desde;

    -- Serie diaria, incluyendo días sin ventas.
    select coalesce(
      jsonb_agg(
        serie.row_data
        order by serie.fecha
      ),
      '[]'::jsonb
    )
    into v_series
    from (
      select
        d::date as fecha,
        jsonb_build_object(
          'fecha',d::date,
          'total',
            coalesce(
              sum(
                greatest(
                  0,
                  coalesce(v.total,0)
                  - coalesce(v.total_devuelto,0)
                )
              ),
              0
            ),
          'tickets',
            count(v.id) filter (
              where v.estado <> 'anulada'
            )
        ) as row_data
      from generate_series(
        v_desde::date,
        current_date,
        interval '1 day'
      ) d
      left join public.ventas v
        on v.negocio_id = v_negocio_id
       and v.sucursal_id = v_sucursal_id
       and v.creado >= d
       and v.creado < d + interval '1 day'
      group by d
    ) serie;

    -- Top productos por unidades netas.
    select coalesce(
      jsonb_agg(
        top_rows.row_data
        order by top_rows.unidades desc
      ),
      '[]'::jsonb
    )
    into v_top
    from (
      select
        vi.producto_id,
        sum(
          greatest(
            0,
            coalesce(vi.cantidad,0)
            - coalesce(vi.cantidad_devuelta,0)
          )
        ) as unidades,
        jsonb_build_object(
          'producto_id',vi.producto_id,
          'nombre',
            max(
              coalesce(
                nullif(vi.producto_nombre,''),
                'Producto'
              )
            ),
          'unidades',
            sum(
              greatest(
                0,
                coalesce(vi.cantidad,0)
                - coalesce(vi.cantidad_devuelta,0)
              )
            ),
          'total',
            round(
              sum(
                greatest(
                  0,
                  coalesce(vi.cantidad,0)
                  - coalesce(vi.cantidad_devuelta,0)
                )
                *
                coalesce(
                  vi.precio_neto_unitario,
                  vi.precio_unitario,
                  0
                )
              ),
              2
            )
        ) as row_data
      from public.venta_items vi
      join public.ventas v
        on v.id = vi.venta_id
      where v.negocio_id = v_negocio_id
        and v.sucursal_id = v_sucursal_id
        and v.creado >= v_desde
        and v.estado <> 'anulada'
      group by vi.producto_id
      having
        sum(
          greatest(
            0,
            coalesce(vi.cantidad,0)
            - coalesce(vi.cantidad_devuelta,0)
          )
        ) > 0
      order by unidades desc
      limit 8
    ) top_rows;

    -- Distribución de cobros. Las devoluciones aparecen
    -- separadas en los KPI de devoluciones.
    select coalesce(
      jsonb_agg(
        payment_rows.row_data
        order by payment_rows.total desc
      ),
      '[]'::jsonb
    )
    into v_payments
    from (
      select
        coalesce(
          nullif(trim(vp.medio_pago),''),
          'Otro'
        ) as medio_pago,
        sum(coalesce(vp.monto,0)) as total,
        jsonb_build_object(
          'medio_pago',
            coalesce(
              nullif(trim(vp.medio_pago),''),
              'Otro'
            ),
          'total',
            round(
              sum(coalesce(vp.monto,0)),
              2
            )
        ) as row_data
      from public.venta_pagos vp
      join public.ventas v
        on v.id = vp.venta_id
      where v.negocio_id = v_negocio_id
        and v.sucursal_id = v_sucursal_id
        and v.creado >= v_desde
        and vp.operacion = 'cobro'
        and v.estado <> 'anulada'
      group by
        coalesce(
          nullif(trim(vp.medio_pago),''),
          'Otro'
        )
    ) payment_rows;

    select coalesce(
      jsonb_agg(to_jsonb(r)),
      '[]'::jsonb
    )
    into v_restock
    from public.recomendaciones_reposicion_v1(
      v_sucursal_id,
      8
    ) r;

    v_alerts :=
      public.alertas_operativas_v1(
        v_sucursal_id
      );

    v_activity :=
      public.actividad_propietario_v1(
        v_sucursal_id,
        12
      );

    -- Cantidad de cajas abiertas del negocio.
    if to_regclass(
        'public.cajas_sesiones'
    ) is not null then
        execute
          'select count(*)
             from public.cajas_sesiones cs
            where to_jsonb(cs)->>''negocio_id'' = $1
              and to_jsonb(cs)->>''estado'' = ''abierta'''
        into v_cash_open
        using v_negocio_id::text;
    end if;

    return jsonb_build_object(
      'sucursal_id',v_sucursal_id,
      'dias',v_dias,
      'ventas_netas',round(v_total,2),
      'ventas_periodo_anterior',
        round(v_total_prev,2),
      'variacion_pct',v_variacion,
      'tickets',v_tickets,
      'ticket_promedio',
        case
          when v_tickets > 0
            then round(v_total/v_tickets,2)
          else 0
        end,
      'margen_estimado',round(v_margin,2),
      'devoluciones_total',round(v_refunds,2),
      'devoluciones_cantidad',v_refund_count,
      'cajas_abiertas',v_cash_open,
      'serie',v_series,
      'top_productos',v_top,
      'medios_pago',v_payments,
      'reposicion',v_restock,
      'alertas',v_alerts,
      'actividad',v_activity,
      'generado_en',now()
    );
end;
$$;

revoke all on function public.dashboard_propietario_v1(
    uuid,integer
) from public;

grant execute on function public.dashboard_propietario_v1(
    uuid,integer
) to authenticated;


-- ============================================================
-- 7. IMPORTADOR MASIVO CSV
-- ============================================================

create or replace function public.importar_productos_masivo_v1(
    p_sucursal_id uuid,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_item record;
    v_producto_id uuid;

    v_nombre text;
    v_barcode text;
    v_categoria text;
    v_stock integer;

    v_importados integer := 0;
    v_omitidos integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para importar productos';
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

    if p_items is null
       or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Archivo inválido';
    end if;

    if jsonb_array_length(p_items) > 2000 then
        raise exception 'Máximo 2000 productos por importación';
    end if;

    for v_item in
      select *
      from jsonb_to_recordset(p_items)
      as x(
        nombre text,
        marca text,
        presentacion text,
        categoria text,
        codigo_barras text,
        precio_compra numeric,
        precio_venta numeric,
        stock integer
      )
    loop
        v_nombre :=
          nullif(
            trim(
              coalesce(v_item.nombre,'')
            ),
            ''
          );

        v_barcode :=
          nullif(
            trim(
              coalesce(v_item.codigo_barras,'')
            ),
            ''
          );

        v_categoria :=
          nullif(
            trim(
              coalesce(v_item.categoria,'')
            ),
            ''
          );

        v_stock :=
          greatest(
            0,
            coalesce(v_item.stock,0)
          );

        if v_nombre is null then
            v_omitidos := v_omitidos + 1;
            continue;
        end if;

        -- Duplicado conservador:
        -- mismo nombre o mismo código dentro del negocio.
        if exists (
            select 1
            from public.productos p
            where p.negocio_id = v_negocio_id
              and (
                lower(trim(p.nombre))
                  = lower(trim(v_nombre))
                or (
                  v_barcode is not null
                  and nullif(
                    trim(
                      coalesce(
                        p.codigo_barras,
                        ''
                      )
                    ),
                    ''
                  ) = v_barcode
                )
              )
        ) then
            v_omitidos := v_omitidos + 1;
            continue;
        end if;

        -- El trigger comercial también valida el límite.
        -- Esta llamada produce un error más claro antes del INSERT.
        perform public.validar_limite_plan_v1(
            v_negocio_id,
            'productos',
            1
        );

        if v_stock > 0
           and not public.puede_modificar_stock_manual_v1(
               v_negocio_id
           ) then
            raise exception
              'Tu usuario puede importar catálogo, pero no cargar stock inicial';
        end if;

        if v_categoria is not null then
            insert into public.categorias(
                negocio_id,
                user_id,
                nombre
            )
            values(
                v_negocio_id,
                auth.uid(),
                v_categoria
            )
            on conflict do nothing;
        end if;

        insert into public.productos(
            negocio_id,
            user_id,
            nombre,
            marca,
            presentacion,
            codigo_barras,
            categoria,
            precio_compra,
            precio_venta,
            stock,
            stock_minimo
        )
        values(
            v_negocio_id,
            auth.uid(),
            v_nombre,
            coalesce(v_item.marca,''),
            coalesce(v_item.presentacion,''),
            v_barcode,
            coalesce(v_categoria,''),
            greatest(
                0,
                coalesce(v_item.precio_compra,0)
            ),
            greatest(
                0,
                coalesce(v_item.precio_venta,0)
            ),
            0,
            0
        )
        returning id
        into v_producto_id;

        perform public.establecer_stock_inicial_v1(
            v_producto_id,
            p_sucursal_id,
            v_stock,
            0
        );

        v_importados :=
          v_importados + 1;
    end loop;

    insert into public.audit_log(
        negocio_id,
        user_id,
        accion,
        entidad,
        detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'catalogo_csv_importado',
        'productos',
        jsonb_build_object(
          'sucursal_id',p_sucursal_id,
          'importados',v_importados,
          'omitidos',v_omitidos
        )
    );

    return jsonb_build_object(
      'ok',true,
      'importados',v_importados,
      'omitidos',v_omitidos
    );
end;
$$;

revoke all on function public.importar_productos_masivo_v1(
    uuid,jsonb
) from public;

grant execute on function public.importar_productos_masivo_v1(
    uuid,jsonb
) to authenticated;


-- ============================================================
-- 8. RESPALDO OPERATIVO
-- ============================================================

create or replace function public.exportar_respaldo_operativo_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_negocio jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner']
    ) then
        raise exception
          'Solo el propietario puede generar un respaldo completo';
    end if;

    select to_jsonb(n)
      into v_negocio
      from public.negocios n
     where n.id = v_negocio_id;

    return jsonb_build_object(
      'formato',
        'vendify-operational-backup-v1',

      'generado_en',
        now(),

      'negocio',
        v_negocio,

      'plan',
        public.obtener_plan_actual_v1(),

      'configuracion',
        public.obtener_config_operativa_v1(),

      'sucursales',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(s)
              order by s.creado
            ),
            '[]'::jsonb
          )
          from public.sucursales s
          where s.negocio_id = v_negocio_id
        ),

      'cajas',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(c)
              order by c.nombre
            ),
            '[]'::jsonb
          )
          from public.cajas c
          where c.negocio_id = v_negocio_id
        ),

      'categorias',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(c) - 'user_id'
              order by c.nombre
            ),
            '[]'::jsonb
          )
          from public.categorias c
          where c.negocio_id = v_negocio_id
        ),

      'productos',
        (
          select coalesce(
            jsonb_agg(
              (
                to_jsonb(pr)
                - 'foto'
                - 'user_id'
              )
              order by pr.nombre
            ),
            '[]'::jsonb
          )
          from public.productos pr
          where pr.negocio_id = v_negocio_id
        ),

      'stock',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(ps)
            ),
            '[]'::jsonb
          )
          from public.producto_stock_sucursal ps
          where ps.negocio_id = v_negocio_id
        ),

      'proveedores',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(pr)
              order by pr.nombre
            ),
            '[]'::jsonb
          )
          from public.proveedores pr
          where pr.negocio_id = v_negocio_id
        ),

      'compras',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(c)
              order by c.creado desc
            ),
            '[]'::jsonb
          )
          from public.compras c
          where c.negocio_id = v_negocio_id
        ),

      'compra_items',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(ci)
            ),
            '[]'::jsonb
          )
          from public.compra_items ci
          where ci.negocio_id = v_negocio_id
        ),

      'ventas',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(v)
              order by v.creado desc
            ),
            '[]'::jsonb
          )
          from public.ventas v
          where v.negocio_id = v_negocio_id
        ),

      'venta_items',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(vi)
            ),
            '[]'::jsonb
          )
          from public.venta_items vi
          where vi.negocio_id = v_negocio_id
        ),

      'venta_pagos',
        (
          select coalesce(
            jsonb_agg(
              to_jsonb(vp)
              order by vp.creado
            ),
            '[]'::jsonb
          )
          from public.venta_pagos vp
          where vp.negocio_id = v_negocio_id
        ),

      'equipo',
        (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'membership_id',nm.id,
                'rol',nm.rol,
                'activo',nm.activo,
                'puede_gestionar_stock',
                  coalesce(
                    nm.puede_gestionar_stock,
                    false
                  ),
                'creado',nm.creado
              )
              order by nm.creado
            ),
            '[]'::jsonb
          )
          from public.negocio_miembros nm
          where nm.negocio_id = v_negocio_id
        )
    );
end;
$$;

revoke all on function public.exportar_respaldo_operativo_v1()
from public;

grant execute on function public.exportar_respaldo_operativo_v1()
to authenticated;


-- ============================================================
-- 9. ADMINISTRACIÓN INTERNA DE VENDIFY
-- ============================================================

create table if not exists public.vendify_platform_admins (
    user_id uuid primary key
      references auth.users(id)
      on delete cascade,
    creado timestamptz not null default now()
);

alter table public.vendify_platform_admins
enable row level security;

revoke all
on table public.vendify_platform_admins
from anon, authenticated;


create or replace function public.es_admin_plataforma_v1()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
      auth.uid() is not null
      and exists (
        select 1
        from public.vendify_platform_admins a
        where a.user_id = auth.uid()
      );
$$;

revoke all
on function public.es_admin_plataforma_v1()
from public;

grant execute
on function public.es_admin_plataforma_v1()
to authenticated;


create or replace function public.platform_overview_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocios integer;
    v_trials integer;
    v_ventas_hoy numeric;
    v_errors integer;
begin
    if not public.es_admin_plataforma_v1() then
        raise exception 'Acceso denegado';
    end if;

    select count(*)
      into v_negocios
      from public.negocios;

    select count(*)
      into v_trials
      from public.vendify_suscripciones s
     where s.estado = 'trial';

    select coalesce(
      sum(
        greatest(
          0,
          coalesce(v.total,0)
          - coalesce(v.total_devuelto,0)
        )
      ),
      0
    )
    into v_ventas_hoy
    from public.ventas v
    where v.creado >=
          date_trunc('day',now());

    select count(*)
      into v_errors
      from public.vendify_error_logs e
     where e.creado >=
           now() - interval '24 hours';

    return jsonb_build_object(
      'negocios',v_negocios,
      'trials',v_trials,
      'ventas_hoy',v_ventas_hoy,
      'errores_24h',v_errors
    );
end;
$$;

revoke all
on function public.platform_overview_v1()
from public;

grant execute
on function public.platform_overview_v1()
to authenticated;


create or replace function public.listar_negocios_plataforma_v1(
    p_limit integer default 50
)
returns table (
    id uuid,
    nombre text,
    plan_codigo text,
    plan_nombre text,
    estado text,
    trial_hasta timestamptz,
    usuarios bigint,
    productos bigint,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.es_admin_plataforma_v1() then
        raise exception 'Acceso denegado';
    end if;

    return query
    select
      n.id,
      coalesce(
        nullif(
          to_jsonb(n)->>'nombre',
          ''
        ),
        'Negocio'
      )::text,
      coalesce(
        vs.plan_codigo,
        'legacy'
      )::text,
      coalesce(
        vp.nombre,
        'Sin plan'
      )::text,
      coalesce(
        vs.estado,
        'sin_plan'
      )::text,
      vs.trial_hasta,
      (
        select count(*)
        from public.negocio_miembros nm
        where nm.negocio_id = n.id
          and nm.activo = true
      )::bigint,
      (
        select count(*)
        from public.productos pr
        where pr.negocio_id = n.id
      )::bigint,
      coalesce(
        nullif(
          to_jsonb(n)->>'creado',
          ''
        )::timestamptz,
        now()
      )
    from public.negocios n
    left join public.vendify_suscripciones vs
      on vs.negocio_id = n.id
    left join public.vendify_planes vp
      on vp.codigo = vs.plan_codigo
    order by
      coalesce(
        nullif(
          to_jsonb(n)->>'creado',
          ''
        )::timestamptz,
        now()
      ) desc
    limit greatest(
      1,
      least(coalesce(p_limit,50),200)
    );
end;
$$;

revoke all
on function public.listar_negocios_plataforma_v1(
    integer
) from public;

grant execute
on function public.listar_negocios_plataforma_v1(
    integer
) to authenticated;



create or replace function public.actualizar_plan_negocio_plataforma_v1(
    p_negocio_id uuid,
    p_plan_codigo text,
    p_estado text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan public.vendify_planes;
    v_trial_hasta timestamptz;
begin
    if not public.es_admin_plataforma_v1() then
        raise exception 'Acceso denegado';
    end if;

    if not exists (
        select 1
        from public.negocios n
        where n.id = p_negocio_id
    ) then
        raise exception 'Negocio inexistente';
    end if;

    if p_estado not in (
        'activo',
        'trial',
        'vencido',
        'suspendido',
        'legacy'
    ) then
        raise exception 'Estado de suscripción inválido';
    end if;

    select *
      into v_plan
      from public.vendify_planes p
     where p.codigo = p_plan_codigo
       and p.activo = true;

    if v_plan.codigo is null then
        raise exception 'Plan inexistente';
    end if;

    if p_plan_codigo = 'trial'
       and p_estado = 'trial' then

        select
          case
            when s.trial_hasta > now()
              then s.trial_hasta
            else
              now()
              + (
                  coalesce(
                    v_plan.trial_dias,
                    14
                  )
                  || ' days'
                )::interval
          end
        into v_trial_hasta
        from public.vendify_suscripciones s
        where s.negocio_id = p_negocio_id;

        if v_trial_hasta is null then
            v_trial_hasta :=
              now()
              + (
                  coalesce(
                    v_plan.trial_dias,
                    14
                  )
                  || ' days'
                )::interval;
        end if;
    else
        v_trial_hasta := null;
    end if;

    insert into public.vendify_suscripciones(
        negocio_id,
        plan_codigo,
        estado,
        trial_hasta,
        actualizado
    )
    values(
        p_negocio_id,
        p_plan_codigo,
        p_estado,
        v_trial_hasta,
        now()
    )
    on conflict (negocio_id) do update
    set plan_codigo = excluded.plan_codigo,
        estado = excluded.estado,
        trial_hasta = excluded.trial_hasta,
        actualizado = now();

    if to_regclass(
        'public.audit_log'
    ) is not null then
        insert into public.audit_log(
            negocio_id,
            user_id,
            accion,
            entidad,
            entidad_id,
            detalle
        )
        values(
            p_negocio_id,
            auth.uid(),
            'platform_plan_actualizado',
            'vendify_suscripciones',
            p_negocio_id,
            jsonb_build_object(
                'plan_codigo',p_plan_codigo,
                'estado',p_estado,
                'trial_hasta',v_trial_hasta
            )
        );
    end if;

    return jsonb_build_object(
        'ok',true,
        'negocio_id',p_negocio_id,
        'plan_codigo',p_plan_codigo,
        'estado',p_estado,
        'trial_hasta',v_trial_hasta
    );
end;
$$;

revoke all
on function public.actualizar_plan_negocio_plataforma_v1(
    uuid,text,text
) from public;

grant execute
on function public.actualizar_plan_negocio_plataforma_v1(
    uuid,text,text
) to authenticated;


create or replace function public.listar_errores_plataforma_v1(
    p_limit integer default 30
)
returns table (
    id uuid,
    negocio_id uuid,
    negocio_nombre text,
    tipo text,
    mensaje text,
    version text,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.es_admin_plataforma_v1() then
        raise exception 'Acceso denegado';
    end if;

    return query
    select
      e.id,
      e.negocio_id,
      coalesce(
        nullif(
          to_jsonb(n)->>'nombre',
          ''
        ),
        'Negocio'
      )::text,
      e.tipo,
      e.mensaje,
      e.version,
      e.creado
    from public.vendify_error_logs e
    join public.negocios n
      on n.id = e.negocio_id
    order by e.creado desc
    limit greatest(
      1,
      least(coalesce(p_limit,30),200)
    );
end;
$$;

revoke all
on function public.listar_errores_plataforma_v1(
    integer
) from public;

grant execute
on function public.listar_errores_plataforma_v1(
    integer
) to authenticated;


-- Limpieza manual de logs antiguos para administración de plataforma.
create or replace function public.limpiar_logs_vendify_v1(
    p_dias integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    if not public.es_admin_plataforma_v1() then
        raise exception 'Acceso denegado';
    end if;

    with deleted as (
      delete from public.vendify_error_logs
      where creado <
            now()
            - (
                greatest(
                  7,
                  least(
                    coalesce(p_dias,90),
                    3650
                  )
                )
                || ' days'
              )::interval
      returning 1
    )
    select count(*)
      into v_count
      from deleted;

    return v_count;
end;
$$;

revoke all
on function public.limpiar_logs_vendify_v1(
    integer
) from public;

grant execute
on function public.limpiar_logs_vendify_v1(
    integer
) to authenticated;


-- ============================================================
-- 10. ÍNDICES PARA DASHBOARD / ALERTAS
-- ============================================================

create index if not exists ventas_dashboard_v231_idx
    on public.ventas(
      negocio_id,
      sucursal_id,
      creado desc
    );

create index if not exists movimientos_alertas_v231_idx
    on public.movimientos(
      negocio_id,
      sucursal_id,
      creado desc
    );

create index if not exists venta_pagos_dashboard_v231_idx
    on public.venta_pagos(
      negocio_id,
      sucursal_id,
      operacion,
      creado desc
    );

create index if not exists producto_stock_dashboard_v231_idx
    on public.producto_stock_sucursal(
      negocio_id,
      sucursal_id,
      stock
    );


notify pgrst, 'reload schema';

commit;
