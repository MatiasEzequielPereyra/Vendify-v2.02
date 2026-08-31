-- ============================================================
-- Vendify v2.30.1.1 — Stability & Data Integrity
-- Ejecutar después de Security FIX3.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. IDEMPOTENCIA DE VENTAS
-- Evita ventas duplicadas si el cliente reintenta el mismo cobro.
-- ------------------------------------------------------------

create table if not exists public.venta_idempotencia_v23011 (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    request_id text not null,
    respuesta jsonb,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (negocio_id, user_id, request_id)
);

alter table public.venta_idempotencia_v23011 enable row level security;
revoke all on table public.venta_idempotencia_v23011 from anon, authenticated;

create or replace function public.registrar_venta_v4(
    p_items jsonb,
    p_pagos jsonb,
    p_descuento_tipo text default null,
    p_descuento_valor numeric default 0,
    p_observacion text default null,
    p_sucursal_id uuid default null,
    p_caja_id uuid default null,
    p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_request_id text;
    v_insertado uuid;
    v_respuesta jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if to_regprocedure(
        'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'
    ) is null then
        raise exception 'Falta instalar registrar_venta_v3 antes de Stability';
    end if;

    v_negocio_id := public.negocio_actual_id();
    v_request_id := nullif(trim(coalesce(p_request_id,'')),'');

    if v_request_id is null
       or length(v_request_id) < 8
       or length(v_request_id) > 100 then
        raise exception 'Identificador de operación inválido';
    end if;

    insert into public.venta_idempotencia_v23011(
        negocio_id,user_id,request_id
    )
    values(
        v_negocio_id,auth.uid(),v_request_id
    )
    on conflict (negocio_id,user_id,request_id) do nothing
    returning id into v_insertado;

    if v_insertado is null then
        select vi.respuesta
          into v_respuesta
          from public.venta_idempotencia_v23011 vi
         where vi.negocio_id = v_negocio_id
           and vi.user_id = auth.uid()
           and vi.request_id = v_request_id;

        if v_respuesta is null then
            raise exception 'La misma venta todavía se está procesando. Esperá un instante.';
        end if;

        return v_respuesta;
    end if;

    v_respuesta := public.registrar_venta_v3(
        p_items,
        p_pagos,
        p_descuento_tipo,
        p_descuento_valor,
        p_observacion,
        p_sucursal_id,
        p_caja_id
    );

    update public.venta_idempotencia_v23011
       set respuesta = v_respuesta,
           actualizado = now()
     where id = v_insertado;

    return v_respuesta;
end;
$$;

revoke all on function public.registrar_venta_v4(
    jsonb,jsonb,text,numeric,text,uuid,uuid,text
) from public;

grant execute on function public.registrar_venta_v4(
    jsonb,jsonb,text,numeric,text,uuid,uuid,text
) to authenticated;

-- ------------------------------------------------------------
-- 2. DIAGNÓSTICO DE INTEGRIDAD
-- Solo Owner/Admin.
-- ------------------------------------------------------------

create or replace function public.diagnostico_integridad_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_count bigint;
    v_issues jsonb := '[]'::jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'Solo Propietario o Administrador pueden ejecutar el diagnóstico';
    end if;

    -- Stock negativo.
    select count(*)
      into v_count
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.stock < 0;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Stock negativo',
                'detail','Hay filas de stock por debajo de cero.',
                'count',v_count
            )
        );
    end if;

    -- Stock actual vs último movimiento auditado.
    select count(*)
      into v_count
      from public.producto_stock_sucursal ps
      join lateral (
          select m.stock_resultante
            from public.movimientos m
           where m.negocio_id = ps.negocio_id
             and m.sucursal_id = ps.sucursal_id
             and m.producto_id = ps.producto_id
             and m.stock_resultante is not null
           order by m.creado desc, m.id desc
           limit 1
      ) lm on true
     where ps.negocio_id = v_negocio_id
       and ps.stock <> lm.stock_resultante;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','warning',
                'title','Stock vs movimientos',
                'detail','El stock actual no coincide con el último movimiento registrado. Puede indicar datos legacy o una modificación sin auditoría.',
                'count',v_count
            )
        );
    end if;

    -- Códigos de barras duplicados dentro del negocio.
    select count(*)
      into v_count
      from (
          select p.codigo_barras
            from public.productos p
           where p.negocio_id = v_negocio_id
             and nullif(trim(coalesce(p.codigo_barras,'')),'') is not null
           group by p.codigo_barras
          having count(*) > 1
      ) d;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Códigos de barras duplicados',
                'detail','Más de un producto del mismo negocio comparte el mismo código.',
                'count',v_count
            )
        );
    end if;

    -- Más de una sesión abierta por caja.
    select count(*)
      into v_count
      from (
          select cs.caja_id
            from public.cajas_sesiones cs
           where cs.negocio_id = v_negocio_id
             and cs.estado = 'abierta'
           group by cs.caja_id
          having count(*) > 1
      ) c;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Caja con múltiples sesiones',
                'detail','Una caja tiene más de un turno abierto simultáneamente.',
                'count',v_count
            )
        );
    end if;

    -- Ventas cuyo cobro no coincide con el total.
    select count(*)
      into v_count
      from public.ventas v
      left join (
          select
              vp.venta_id,
              sum(vp.monto) filter (where vp.operacion = 'cobro') as cobrado
          from public.venta_pagos vp
          where vp.negocio_id = v_negocio_id
          group by vp.venta_id
      ) p on p.venta_id = v.id
     where v.negocio_id = v_negocio_id
       and abs(coalesce(p.cobrado,0) - coalesce(v.total,0)) > 0.01;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Cobros inconsistentes',
                'detail','Hay ventas cuyo total no coincide con la suma de cobros registrados.',
                'count',v_count
            )
        );
    end if;

    -- Categorías legacy sin negocio.
    if to_regclass('public.categorias') is not null then
        select count(*)
          into v_count
          from public.categorias c
         where c.negocio_id is null;

        if v_count > 0 then
            v_issues := v_issues || jsonb_build_array(
                jsonb_build_object(
                    'severity','warning',
                    'title','Categorías legacy',
                    'detail','Existen categorías que todavía no están asociadas a un negocio.',
                    'count',v_count
                )
            );
        end if;
    end if;

    return jsonb_build_object(
        'ok',
        not exists (
            select 1
            from jsonb_array_elements(v_issues) x
            where x->>'severity' = 'critical'
        ),
        'issues',v_issues,
        'checked_at',now()
    );
end;
$$;

revoke all on function public.diagnostico_integridad_v1() from public;
grant execute on function public.diagnostico_integridad_v1() to authenticated;

notify pgrst, 'reload schema';

commit;
