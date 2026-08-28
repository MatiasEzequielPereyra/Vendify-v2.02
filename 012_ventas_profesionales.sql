-- ============================================================
-- Vendify v2.28 — Ventas profesionales
-- Ejecutar DESPUÉS de 011_caja_profesional.sql
--
-- Incluye:
-- - descuentos por % o monto
-- - pagos simples y mixtos
-- - observaciones
-- - tickets / reimpresión
-- - devoluciones parciales o totales
-- - anulación auditada sin borrar ventas
-- - reintegros vinculados a la caja actual
-- - caja compatible con pagos mixtos y devoluciones
-- ============================================================

begin;

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. ESTADO Y TOTALES DE VENTAS
-- ============================================================

alter table public.ventas
    add column if not exists estado text not null default 'completada',
    add column if not exists subtotal numeric(14,2),
    add column if not exists descuento_tipo text,
    add column if not exists descuento_valor numeric(14,2) not null default 0,
    add column if not exists descuento_total numeric(14,2) not null default 0,
    add column if not exists observacion text,
    add column if not exists total_devuelto numeric(14,2) not null default 0,
    add column if not exists anulada_en timestamptz,
    add column if not exists anulada_por uuid references auth.users(id) on delete set null,
    add column if not exists motivo_anulacion text;

update public.ventas
set subtotal = total
where subtotal is null;

alter table public.ventas
    alter column subtotal set default 0;

alter table public.ventas
    alter column subtotal set not null;

alter table public.ventas
    drop constraint if exists ventas_estado_check_v228;

alter table public.ventas
    add constraint ventas_estado_check_v228
    check (
        estado in (
            'completada',
            'parcialmente_devuelta',
            'devuelta',
            'anulada'
        )
    );

alter table public.ventas
    drop constraint if exists ventas_descuento_tipo_check_v228;

alter table public.ventas
    add constraint ventas_descuento_tipo_check_v228
    check (
        descuento_tipo is null
        or descuento_tipo in ('porcentaje','monto')
    );

-- ============================================================
-- 2. DETALLE NETO POR ITEM
-- ============================================================

alter table public.venta_items
    add column if not exists precio_neto_unitario numeric(14,4),
    add column if not exists cantidad_devuelta integer not null default 0;

update public.venta_items
set precio_neto_unitario = precio_unitario
where precio_neto_unitario is null;

alter table public.venta_items
    alter column precio_neto_unitario set not null;

alter table public.venta_items
    drop constraint if exists venta_items_cantidad_devuelta_check_v228;

alter table public.venta_items
    add constraint venta_items_cantidad_devuelta_check_v228
    check (
        cantidad_devuelta >= 0
        and cantidad_devuelta <= cantidad
    );

-- ============================================================
-- 3. PAGOS / REINTEGROS
-- ============================================================

create table if not exists public.venta_pagos (
    id uuid primary key default gen_random_uuid(),
    venta_id uuid not null references public.ventas(id) on delete cascade,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    caja_id uuid references public.cajas(id) on delete set null,
    caja_sesion_id uuid references public.cajas_sesiones(id) on delete set null,
    user_id uuid not null references auth.users(id) on delete restrict,

    operacion text not null default 'cobro'
        check (operacion in ('cobro','devolucion')),

    medio_pago text not null,
    monto numeric(14,2) not null check (monto > 0),
    creado timestamptz not null default now()
);

create index if not exists venta_pagos_venta_idx
    on public.venta_pagos(venta_id, creado);

create index if not exists venta_pagos_sesion_idx
    on public.venta_pagos(caja_sesion_id, creado);

alter table public.venta_pagos enable row level security;

drop policy if exists "venta_pagos_select_miembros"
    on public.venta_pagos;

create policy "venta_pagos_select_miembros"
on public.venta_pagos
for select
using (
    public.es_miembro_negocio(negocio_id)
);

-- Backfill de ventas anteriores.
insert into public.venta_pagos(
    venta_id,
    negocio_id,
    sucursal_id,
    caja_id,
    caja_sesion_id,
    user_id,
    operacion,
    medio_pago,
    monto,
    creado
)
select
    v.id,
    v.negocio_id,
    v.sucursal_id,
    v.caja_id,
    v.caja_sesion_id,
    v.user_id,
    'cobro',
    coalesce(nullif(trim(v.medio_pago),''),'Otro'),
    v.total,
    v.creado
from public.ventas v
where v.total > 0
  and not exists (
      select 1
      from public.venta_pagos vp
      where vp.venta_id = v.id
        and vp.operacion = 'cobro'
  );

-- ============================================================
-- 4. DEVOLUCIONES
-- ============================================================

create table if not exists public.venta_devoluciones (
    id uuid primary key default gen_random_uuid(),
    venta_id uuid not null references public.ventas(id) on delete restrict,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,

    caja_id uuid references public.cajas(id) on delete set null,
    caja_sesion_id uuid references public.cajas_sesiones(id) on delete set null,

    user_id uuid not null references auth.users(id) on delete restrict,

    tipo text not null default 'devolucion'
        check (tipo in ('devolucion','anulacion')),

    medio_reintegro text,
    total numeric(14,2) not null default 0 check (total >= 0),
    motivo text not null,

    creado timestamptz not null default now()
);

create table if not exists public.venta_devolucion_items (
    id uuid primary key default gen_random_uuid(),
    devolucion_id uuid not null references public.venta_devoluciones(id) on delete cascade,
    venta_id uuid not null references public.ventas(id) on delete restrict,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    producto_id uuid not null references public.productos(id) on delete restrict,
    producto_nombre text not null,
    cantidad integer not null check (cantidad > 0),
    precio_neto_unitario numeric(14,4) not null,
    subtotal numeric(14,2) not null,
    creado timestamptz not null default now()
);

create index if not exists venta_devoluciones_venta_idx
    on public.venta_devoluciones(venta_id, creado desc);

create index if not exists venta_devolucion_items_devolucion_idx
    on public.venta_devolucion_items(devolucion_id);

alter table public.venta_devoluciones enable row level security;
alter table public.venta_devolucion_items enable row level security;

drop policy if exists "venta_devoluciones_select_miembros"
    on public.venta_devoluciones;

create policy "venta_devoluciones_select_miembros"
on public.venta_devoluciones
for select
using (
    public.es_miembro_negocio(negocio_id)
);

drop policy if exists "venta_devolucion_items_select_miembros"
    on public.venta_devolucion_items;

create policy "venta_devolucion_items_select_miembros"
on public.venta_devolucion_items
for select
using (
    public.es_miembro_negocio(negocio_id)
);

-- ============================================================
-- 5. MOVIMIENTOS: AGREGAR DEVOLUCION AL CHECK SIN ROMPER
--    LOS TIPOS QUE YA EXISTEN
-- ============================================================

do $$
declare
    v_tipos text;
begin
    select string_agg(quote_literal(tipo), ', ' order by tipo)
      into v_tipos
      from (
          select distinct tipo::text as tipo
          from public.movimientos
          where tipo is not null

          union select 'venta'
          union select 'ajuste'
          union select 'transferencia_salida'
          union select 'transferencia_entrada'
          union select 'devolucion'
      ) x;

    alter table public.movimientos
        drop constraint if exists movimientos_tipo_check;

    execute format(
        'alter table public.movimientos
         add constraint movimientos_tipo_check
         check (tipo in (%s))',
        v_tipos
    );
end $$;

-- ============================================================
-- 6. CAJA ABIERTA ACTUAL PARA DEVOLUCIONES
-- ============================================================

create or replace function public.caja_sesion_operable_v228(
    p_caja_id uuid,
    p_sucursal_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sesion_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    select cs.id
      into v_sesion_id
      from public.cajas_sesiones cs
     where cs.negocio_id = v_negocio_id
       and cs.sucursal_id = p_sucursal_id
       and cs.caja_id = p_caja_id
       and cs.estado = 'abierta'
       and cs.user_id = auth.uid()
     limit 1;

    if v_sesion_id is null then
        raise exception 'Abrí una caja propia de esta sucursal antes de realizar el reintegro';
    end if;

    return v_sesion_id;
end;
$$;

revoke all on function public.caja_sesion_operable_v228(uuid,uuid) from public;

-- ============================================================
-- 7. REGISTRAR VENTA V3
-- ============================================================

create or replace function public.registrar_venta_v3(
    p_items jsonb,
    p_pagos jsonb,
    p_descuento_tipo text default null,
    p_descuento_valor numeric default 0,
    p_observacion text default null,
    p_sucursal_id uuid default null,
    p_caja_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal_id uuid;
    v_caja_id uuid;
    v_sesion public.cajas_sesiones;

    v_subtotal numeric(14,2) := 0;
    v_descuento numeric(14,2) := 0;
    v_total numeric(14,2) := 0;
    v_factor numeric := 1;

    v_total_pagos numeric(14,2) := 0;
    v_cantidad_pagos integer := 0;
    v_medio_resumen text;

    v_venta public.ventas;
    v_item record;
    v_pago record;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;

    v_items_json jsonb;
    v_pagos_json jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'El carrito está vacío';
    end if;

    if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' then
        raise exception 'Formato de pagos inválido';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager','cashier']
    ) then
        raise exception 'No tenés permiso para registrar ventas';
    end if;

    select s.id
      into v_sucursal_id
      from public.sucursales s
     where s.id = p_sucursal_id
       and s.negocio_id = v_negocio_id
       and s.activa = true;

    if v_sucursal_id is null then
        raise exception 'Sucursal inválida';
    end if;

    select c.id
      into v_caja_id
      from public.cajas c
     where c.id = p_caja_id
       and c.negocio_id = v_negocio_id
       and c.sucursal_id = v_sucursal_id
       and c.activa = true;

    if v_caja_id is null then
        raise exception 'Caja inválida';
    end if;

    select *
      into v_sesion
      from public.cajas_sesiones cs
     where cs.caja_id = v_caja_id
       and cs.negocio_id = v_negocio_id
       and cs.sucursal_id = v_sucursal_id
       and cs.estado = 'abierta'
       and cs.user_id = auth.uid()
     for update;

    if not found then
        raise exception 'Abrí esta caja con tu usuario antes de vender';
    end if;

    -- Validación + subtotal + locks.
    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            sum((x->>'cantidad')::integer)::integer as cantidad
        from jsonb_array_elements(p_items) x
        group by (x->>'producto_id')::uuid
    loop
        if v_item.cantidad is null or v_item.cantidad <= 0 then
            raise exception 'Cantidad inválida';
        end if;

        select *
          into v_producto
          from public.productos
         where id = v_item.producto_id
           and negocio_id = v_negocio_id;

        if not found then
            raise exception 'Producto no encontrado';
        end if;

        select *
          into v_stock
          from public.producto_stock_sucursal
         where producto_id = v_producto.id
           and sucursal_id = v_sucursal_id
           and negocio_id = v_negocio_id
         for update;

        if not found then
            raise exception 'El producto "%" no tiene stock en esta sucursal',
                v_producto.nombre;
        end if;

        if v_stock.stock < v_item.cantidad then
            raise exception 'Stock insuficiente de "%": quedan % unidades',
                v_producto.nombre,
                v_stock.stock;
        end if;

        v_subtotal := v_subtotal
            + round(v_producto.precio_venta * v_item.cantidad, 2);
    end loop;

    -- Descuento.
    if p_descuento_tipo is null or trim(p_descuento_tipo) = '' then
        v_descuento := 0;
        p_descuento_tipo := null;
        p_descuento_valor := 0;

    elsif p_descuento_tipo = 'porcentaje' then
        if coalesce(p_descuento_valor,0) < 0
           or coalesce(p_descuento_valor,0) > 100 then
            raise exception 'El descuento porcentual debe estar entre 0 y 100';
        end if;

        v_descuento := round(
            v_subtotal * coalesce(p_descuento_valor,0) / 100.0,
            2
        );

    elsif p_descuento_tipo = 'monto' then
        if coalesce(p_descuento_valor,0) < 0
           or coalesce(p_descuento_valor,0) > v_subtotal then
            raise exception 'El descuento no puede superar el subtotal';
        end if;

        v_descuento := round(coalesce(p_descuento_valor,0),2);

    else
        raise exception 'Tipo de descuento inválido';
    end if;

    v_total := greatest(round(v_subtotal - v_descuento,2),0);

    if v_subtotal > 0 then
        v_factor := v_total / v_subtotal;
    end if;

    -- Validación de pagos.
    for v_pago in
        select
            trim(x->>'medio_pago') as medio_pago,
            round((x->>'monto')::numeric,2) as monto
        from jsonb_array_elements(p_pagos) x
    loop
        if coalesce(v_pago.medio_pago,'') = '' then
            raise exception 'Medio de pago inválido';
        end if;

        if v_pago.monto is null or v_pago.monto <= 0 then
            raise exception 'Monto de pago inválido';
        end if;

        v_total_pagos := v_total_pagos + v_pago.monto;
        v_cantidad_pagos := v_cantidad_pagos + 1;

        if v_cantidad_pagos = 1 then
            v_medio_resumen := v_pago.medio_pago;
        end if;
    end loop;

    if v_total = 0 then
        if v_total_pagos <> 0 then
            raise exception 'Una venta con total $0 no debe registrar cobros';
        end if;
        v_medio_resumen := 'Sin cargo';
    else
        if v_cantidad_pagos = 0 then
            raise exception 'Ingresá al menos un medio de pago';
        end if;

        if abs(v_total_pagos - v_total) > 0.01 then
            raise exception 'Los pagos suman % y el total de la venta es %',
                v_total_pagos,
                v_total;
        end if;

        if v_cantidad_pagos > 1 then
            v_medio_resumen := 'Mixto';
        end if;
    end if;

    insert into public.ventas(
        user_id,
        negocio_id,
        sucursal_id,
        caja_id,
        caja_sesion_id,
        subtotal,
        descuento_tipo,
        descuento_valor,
        descuento_total,
        total,
        total_devuelto,
        estado,
        medio_pago,
        observacion
    )
    values(
        auth.uid(),
        v_negocio_id,
        v_sucursal_id,
        v_caja_id,
        v_sesion.id,
        v_subtotal,
        p_descuento_tipo,
        round(coalesce(p_descuento_valor,0),2),
        v_descuento,
        v_total,
        0,
        'completada',
        v_medio_resumen,
        nullif(trim(coalesce(p_observacion,'')),'')
    )
    returning * into v_venta;

    -- Items + stock.
    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            sum((x->>'cantidad')::integer)::integer as cantidad
        from jsonb_array_elements(p_items) x
        group by (x->>'producto_id')::uuid
    loop
        select *
          into v_producto
          from public.productos
         where id = v_item.producto_id
           and negocio_id = v_negocio_id;

        update public.producto_stock_sucursal
           set stock = stock - v_item.cantidad,
               actualizado = now()
         where producto_id = v_producto.id
           and sucursal_id = v_sucursal_id
           and negocio_id = v_negocio_id
           and stock >= v_item.cantidad
         returning * into v_stock;

        if not found then
            raise exception 'No se pudo descontar stock de forma segura';
        end if;

        insert into public.venta_items(
            venta_id,
            user_id,
            negocio_id,
            producto_id,
            producto_nombre,
            cantidad,
            precio_unitario,
            precio_neto_unitario,
            costo_unitario,
            subtotal,
            cantidad_devuelta
        )
        values(
            v_venta.id,
            auth.uid(),
            v_negocio_id,
            v_producto.id,
            v_producto.nombre,
            v_item.cantidad,
            v_producto.precio_venta,
            round(v_producto.precio_venta * v_factor,4),
            v_producto.precio_compra,
            round(v_producto.precio_venta * v_item.cantidad,2),
            0
        );

        insert into public.movimientos(
            user_id,
            negocio_id,
            sucursal_id,
            producto_id,
            producto_nombre,
            tipo,
            delta,
            stock_resultante
        )
        values(
            auth.uid(),
            v_negocio_id,
            v_sucursal_id,
            v_producto.id,
            v_producto.nombre,
            'venta',
            -v_item.cantidad,
            v_stock.stock
        );
    end loop;

    -- Pagos.
    for v_pago in
        select
            trim(x->>'medio_pago') as medio_pago,
            round((x->>'monto')::numeric,2) as monto
        from jsonb_array_elements(p_pagos) x
    loop
        insert into public.venta_pagos(
            venta_id,
            negocio_id,
            sucursal_id,
            caja_id,
            caja_sesion_id,
            user_id,
            operacion,
            medio_pago,
            monto
        )
        values(
            v_venta.id,
            v_negocio_id,
            v_sucursal_id,
            v_caja_id,
            v_sesion.id,
            auth.uid(),
            'cobro',
            v_pago.medio_pago,
            v_pago.monto
        );
    end loop;

    select coalesce(jsonb_agg(to_jsonb(vi) order by vi.producto_nombre),'[]'::jsonb)
      into v_items_json
      from public.venta_items vi
     where vi.venta_id = v_venta.id;

    select coalesce(jsonb_agg(to_jsonb(vp) order by vp.creado),'[]'::jsonb)
      into v_pagos_json
      from public.venta_pagos vp
     where vp.venta_id = v_venta.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'venta_registrada',
        'ventas',
        v_venta.id,
        jsonb_build_object(
            'subtotal',v_subtotal,
            'descuento',v_descuento,
            'total',v_total,
            'pagos',v_pagos_json,
            'sucursal_id',v_sucursal_id,
            'caja_id',v_caja_id
        )
    );

    return jsonb_build_object(
        'venta',to_jsonb(v_venta),
        'items',v_items_json,
        'pagos',v_pagos_json
    );
end;
$$;

revoke all on function public.registrar_venta_v3(
    jsonb,jsonb,text,numeric,text,uuid,uuid
) from public;

grant execute on function public.registrar_venta_v3(
    jsonb,jsonb,text,numeric,text,uuid,uuid
) to authenticated;

-- ============================================================
-- 8. DEVOLUCIÓN
-- ============================================================

create or replace function public.devolver_venta_v1(
    p_venta_id uuid,
    p_items jsonb,
    p_caja_id uuid,
    p_medio_reintegro text,
    p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_venta public.ventas;
    v_sesion_id uuid;
    v_dev public.venta_devoluciones;
    v_item_req record;
    v_item public.venta_items;
    v_stock public.producto_stock_sucursal;

    v_total numeric(14,2) := 0;
    v_restante numeric(14,2) := 0;
    v_todas_restantes boolean := true;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para realizar devoluciones';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'Seleccioná al menos un artículo para devolver';
    end if;

    if length(trim(coalesce(p_motivo,''))) < 2 then
        raise exception 'Ingresá un motivo';
    end if;

    if length(trim(coalesce(p_medio_reintegro,''))) < 2 then
        raise exception 'Seleccioná el medio del reintegro';
    end if;

    select *
      into v_venta
      from public.ventas
     where id = p_venta_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Venta inexistente';
    end if;

    if v_venta.estado in ('anulada','devuelta') then
        raise exception 'Esta venta ya no tiene saldo para devolver';
    end if;

    v_sesion_id := public.caja_sesion_operable_v228(
        p_caja_id,
        v_venta.sucursal_id
    );

    v_restante := greatest(v_venta.total - v_venta.total_devuelto,0);

    -- Verificar que NO haya item restante que quede afuera del pedido completo.
    if exists (
        select 1
        from public.venta_items vi
        where vi.venta_id = v_venta.id
          and vi.cantidad > vi.cantidad_devuelta
          and not exists (
              select 1
              from jsonb_array_elements(p_items) x
              where (x->>'item_id')::uuid = vi.id
                and (x->>'cantidad')::integer = (vi.cantidad - vi.cantidad_devuelta)
          )
    ) then
        v_todas_restantes := false;
    end if;

    -- Validar y calcular.
    for v_item_req in
        select
            (x->>'item_id')::uuid as item_id,
            (x->>'cantidad')::integer as cantidad
        from jsonb_array_elements(p_items) x
    loop
        select *
          into v_item
          from public.venta_items vi
         where vi.id = v_item_req.item_id
           and vi.venta_id = v_venta.id
         for update;

        if not found then
            raise exception 'Artículo de venta inválido';
        end if;

        if v_item_req.cantidad is null
           or v_item_req.cantidad <= 0
           or v_item_req.cantidad > (v_item.cantidad - v_item.cantidad_devuelta) then
            raise exception 'Cantidad de devolución inválida para "%"',
                v_item.producto_nombre;
        end if;

        v_total := v_total
            + round(v_item.precio_neto_unitario * v_item_req.cantidad,2);
    end loop;

    if v_todas_restantes then
        v_total := v_restante;
    else
        v_total := least(v_total,v_restante);
    end if;

    insert into public.venta_devoluciones(
        venta_id,
        negocio_id,
        sucursal_id,
        caja_id,
        caja_sesion_id,
        user_id,
        tipo,
        medio_reintegro,
        total,
        motivo
    )
    values(
        v_venta.id,
        v_negocio_id,
        v_venta.sucursal_id,
        p_caja_id,
        v_sesion_id,
        auth.uid(),
        'devolucion',
        trim(p_medio_reintegro),
        v_total,
        trim(p_motivo)
    )
    returning * into v_dev;

    -- Aplicar items.
    for v_item_req in
        select
            (x->>'item_id')::uuid as item_id,
            (x->>'cantidad')::integer as cantidad
        from jsonb_array_elements(p_items) x
    loop
        select *
          into v_item
          from public.venta_items vi
         where vi.id = v_item_req.item_id
           and vi.venta_id = v_venta.id
         for update;

        update public.venta_items
           set cantidad_devuelta = cantidad_devuelta + v_item_req.cantidad
         where id = v_item.id;

        update public.producto_stock_sucursal
           set stock = stock + v_item_req.cantidad,
               actualizado = now()
         where producto_id = v_item.producto_id
           and sucursal_id = v_venta.sucursal_id
           and negocio_id = v_negocio_id
         returning * into v_stock;

        if not found then
            raise exception 'No se pudo restaurar stock de "%"',
                v_item.producto_nombre;
        end if;

        insert into public.venta_devolucion_items(
            devolucion_id,
            venta_id,
            negocio_id,
            sucursal_id,
            producto_id,
            producto_nombre,
            cantidad,
            precio_neto_unitario,
            subtotal
        )
        values(
            v_dev.id,
            v_venta.id,
            v_negocio_id,
            v_venta.sucursal_id,
            v_item.producto_id,
            v_item.producto_nombre,
            v_item_req.cantidad,
            v_item.precio_neto_unitario,
            round(v_item.precio_neto_unitario * v_item_req.cantidad,2)
        );

        insert into public.movimientos(
            user_id,
            negocio_id,
            sucursal_id,
            producto_id,
            producto_nombre,
            tipo,
            delta,
            stock_resultante
        )
        values(
            auth.uid(),
            v_negocio_id,
            v_venta.sucursal_id,
            v_item.producto_id,
            v_item.producto_nombre,
            'devolucion',
            v_item_req.cantidad,
            v_stock.stock
        );
    end loop;

    if v_total > 0 then
        insert into public.venta_pagos(
            venta_id,
            negocio_id,
            sucursal_id,
            caja_id,
            caja_sesion_id,
            user_id,
            operacion,
            medio_pago,
            monto
        )
        values(
            v_venta.id,
            v_negocio_id,
            v_venta.sucursal_id,
            p_caja_id,
            v_sesion_id,
            auth.uid(),
            'devolucion',
            trim(p_medio_reintegro),
            v_total
        );
    end if;

    update public.ventas
       set total_devuelto = least(total, total_devuelto + v_total),
           estado = case
               when total_devuelto + v_total >= total - 0.01
                   then 'devuelta'
               else 'parcialmente_devuelta'
           end
     where id = v_venta.id
     returning * into v_venta;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'venta_devuelta',
        'ventas',
        v_venta.id,
        jsonb_build_object(
            'devolucion_id',v_dev.id,
            'total',v_total,
            'medio_reintegro',trim(p_medio_reintegro),
            'motivo',trim(p_motivo)
        )
    );

    return jsonb_build_object(
        'ok',true,
        'venta',to_jsonb(v_venta),
        'devolucion',to_jsonb(v_dev)
    );
end;
$$;

revoke all on function public.devolver_venta_v1(
    uuid,jsonb,uuid,text,text
) from public;

grant execute on function public.devolver_venta_v1(
    uuid,jsonb,uuid,text,text
) to authenticated;

-- ============================================================
-- 9. ANULAR VENTA (DEVOLUCIÓN COMPLETA)
-- ============================================================

create or replace function public.anular_venta_v1(
    p_venta_id uuid,
    p_caja_id uuid,
    p_medio_reintegro text,
    p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_venta public.ventas;
    v_sesion_id uuid;
    v_dev public.venta_devoluciones;
    v_item public.venta_items;
    v_stock public.producto_stock_sucursal;
    v_total numeric(14,2);
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para anular ventas';
    end if;

    if length(trim(coalesce(p_motivo,''))) < 2 then
        raise exception 'Ingresá el motivo de la anulación';
    end if;

    if length(trim(coalesce(p_medio_reintegro,''))) < 2 then
        raise exception 'Seleccioná el medio del reintegro';
    end if;

    select *
      into v_venta
      from public.ventas
     where id = p_venta_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Venta inexistente';
    end if;

    if v_venta.estado <> 'completada'
       or v_venta.total_devuelto > 0 then
        raise exception 'Solo se puede anular una venta completa sin devoluciones previas';
    end if;

    v_sesion_id := public.caja_sesion_operable_v228(
        p_caja_id,
        v_venta.sucursal_id
    );

    v_total := v_venta.total;

    insert into public.venta_devoluciones(
        venta_id,
        negocio_id,
        sucursal_id,
        caja_id,
        caja_sesion_id,
        user_id,
        tipo,
        medio_reintegro,
        total,
        motivo
    )
    values(
        v_venta.id,
        v_negocio_id,
        v_venta.sucursal_id,
        p_caja_id,
        v_sesion_id,
        auth.uid(),
        'anulacion',
        trim(p_medio_reintegro),
        v_total,
        trim(p_motivo)
    )
    returning * into v_dev;

    for v_item in
        select *
        from public.venta_items vi
        where vi.venta_id = v_venta.id
        for update
    loop
        update public.venta_items
           set cantidad_devuelta = cantidad
         where id = v_item.id;

        update public.producto_stock_sucursal
           set stock = stock + (v_item.cantidad - v_item.cantidad_devuelta),
               actualizado = now()
         where producto_id = v_item.producto_id
           and sucursal_id = v_venta.sucursal_id
           and negocio_id = v_negocio_id
         returning * into v_stock;

        if not found then
            raise exception 'No se pudo restaurar stock de "%"',
                v_item.producto_nombre;
        end if;

        insert into public.venta_devolucion_items(
            devolucion_id,
            venta_id,
            negocio_id,
            sucursal_id,
            producto_id,
            producto_nombre,
            cantidad,
            precio_neto_unitario,
            subtotal
        )
        values(
            v_dev.id,
            v_venta.id,
            v_negocio_id,
            v_venta.sucursal_id,
            v_item.producto_id,
            v_item.producto_nombre,
            v_item.cantidad,
            v_item.precio_neto_unitario,
            round(v_item.precio_neto_unitario * v_item.cantidad,2)
        );

        insert into public.movimientos(
            user_id,
            negocio_id,
            sucursal_id,
            producto_id,
            producto_nombre,
            tipo,
            delta,
            stock_resultante
        )
        values(
            auth.uid(),
            v_negocio_id,
            v_venta.sucursal_id,
            v_item.producto_id,
            v_item.producto_nombre,
            'devolucion',
            v_item.cantidad,
            v_stock.stock
        );
    end loop;

    if v_total > 0 then
        insert into public.venta_pagos(
            venta_id,
            negocio_id,
            sucursal_id,
            caja_id,
            caja_sesion_id,
            user_id,
            operacion,
            medio_pago,
            monto
        )
        values(
            v_venta.id,
            v_negocio_id,
            v_venta.sucursal_id,
            p_caja_id,
            v_sesion_id,
            auth.uid(),
            'devolucion',
            trim(p_medio_reintegro),
            v_total
        );
    end if;

    update public.ventas
       set estado = 'anulada',
           total_devuelto = total,
           anulada_en = now(),
           anulada_por = auth.uid(),
           motivo_anulacion = trim(p_motivo)
     where id = v_venta.id
     returning * into v_venta;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'venta_anulada',
        'ventas',
        v_venta.id,
        jsonb_build_object(
            'devolucion_id',v_dev.id,
            'total',v_total,
            'medio_reintegro',trim(p_medio_reintegro),
            'motivo',trim(p_motivo)
        )
    );

    return jsonb_build_object(
        'ok',true,
        'venta',to_jsonb(v_venta),
        'devolucion',to_jsonb(v_dev)
    );
end;
$$;

revoke all on function public.anular_venta_v1(
    uuid,uuid,text,text
) from public;

grant execute on function public.anular_venta_v1(
    uuid,uuid,text,text
) to authenticated;

-- ============================================================
-- 10. CAJA V2.28
-- Los totales se calculan desde venta_pagos:
-- cobro = positivo
-- devolución = negativo
-- ============================================================

create or replace function public.obtener_estado_caja_v1(
    p_caja_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_caja public.cajas;
    v_sesion public.cajas_sesiones;
    v_ventas_total numeric := 0;
    v_ventas_efectivo numeric := 0;
    v_tickets integer := 0;
    v_ingresos numeric := 0;
    v_retiros numeric := 0;
    v_esperado numeric := 0;
    v_nombre_usuario text;
    v_role text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select *
      into v_caja
      from public.cajas c
     where c.id = p_caja_id
       and c.negocio_id = v_negocio_id
       and c.activa = true;

    if not found then
        raise exception 'Caja inexistente o inactiva';
    end if;

    select *
      into v_sesion
      from public.cajas_sesiones cs
     where cs.caja_id = p_caja_id
       and cs.negocio_id = v_negocio_id
       and cs.estado = 'abierta'
     order by cs.abierta_en desc
     limit 1;

    select nm.rol
      into v_role
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    if not found then
        raise exception 'Usuario sin membresía activa';
    end if;

    if v_sesion.id is null then
        return jsonb_build_object(
            'caja', jsonb_build_object(
                'id', v_caja.id,
                'nombre', v_caja.nombre,
                'sucursal_id', v_caja.sucursal_id
            ),
            'sesion', null,
            'es_mia', false,
            'puede_supervisar', v_role in ('owner','admin','manager')
        );
    end if;

    select
        coalesce(sum(
            case when vp.operacion='cobro' then vp.monto else -vp.monto end
        ),0),
        coalesce(sum(
            case
                when lower(vp.medio_pago)='efectivo'
                    then case when vp.operacion='cobro' then vp.monto else -vp.monto end
                else 0
            end
        ),0),
        count(distinct vp.venta_id) filter (where vp.operacion='cobro')::integer
      into v_ventas_total, v_ventas_efectivo, v_tickets
      from public.venta_pagos vp
     where vp.caja_sesion_id = v_sesion.id;

    select
        coalesce(sum(cm.monto) filter (where cm.tipo='ingreso'),0),
        coalesce(sum(cm.monto) filter (where cm.tipo='retiro'),0)
      into v_ingresos, v_retiros
      from public.caja_movimientos cm
     where cm.sesion_id = v_sesion.id;

    v_esperado :=
        v_sesion.fondo_inicial
        + v_ventas_efectivo
        + v_ingresos
        - v_retiros;

    select coalesce(e.nombre, split_part(u.email,'@',1), 'Usuario')
      into v_nombre_usuario
      from auth.users u
      left join public.empleados e
        on e.user_id = u.id
       and e.negocio_id = v_negocio_id
     where u.id = v_sesion.user_id;

    return jsonb_build_object(
        'caja', jsonb_build_object(
            'id', v_caja.id,
            'nombre', v_caja.nombre,
            'sucursal_id', v_caja.sucursal_id
        ),
        'sesion', jsonb_build_object(
            'id', v_sesion.id,
            'user_id', v_sesion.user_id,
            'usuario_nombre', coalesce(v_nombre_usuario,'Usuario'),
            'fondo_inicial', v_sesion.fondo_inicial,
            'abierta_en', v_sesion.abierta_en,
            'nota_apertura', v_sesion.nota_apertura,
            'ventas_total', round(v_ventas_total,2),
            'ventas_efectivo', round(v_ventas_efectivo,2),
            'tickets', v_tickets,
            'ingresos_total', v_ingresos,
            'retiros_total', v_retiros,
            'efectivo_esperado', round(v_esperado,2)
        ),
        'es_mia', v_sesion.user_id = auth.uid(),
        'puede_supervisar', v_role in ('owner','admin','manager')
    );
end;
$$;

revoke all on function public.obtener_estado_caja_v1(uuid) from public;
grant execute on function public.obtener_estado_caja_v1(uuid) to authenticated;

create or replace function public.cerrar_caja_v1(
    p_caja_id uuid,
    p_efectivo_declarado numeric,
    p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sesion public.cajas_sesiones;
    v_role text;
    v_ventas_total numeric := 0;
    v_ventas_efectivo numeric := 0;
    v_tickets integer := 0;
    v_ingresos numeric := 0;
    v_retiros numeric := 0;
    v_esperado numeric := 0;
    v_diferencia numeric := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_efectivo_declarado is null or p_efectivo_declarado < 0 then
        raise exception 'Efectivo declarado inválido';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select nm.rol
      into v_role
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    select *
      into v_sesion
      from public.cajas_sesiones cs
     where cs.caja_id = p_caja_id
       and cs.negocio_id = v_negocio_id
       and cs.estado = 'abierta'
     for update;

    if not found then
        raise exception 'La caja no está abierta';
    end if;

    if v_sesion.user_id <> auth.uid()
       and coalesce(v_role,'') not in ('owner','admin','manager') then
        raise exception 'Solo quien abrió la caja puede cerrarla';
    end if;

    select
        coalesce(sum(
            case when vp.operacion='cobro' then vp.monto else -vp.monto end
        ),0),
        coalesce(sum(
            case
                when lower(vp.medio_pago)='efectivo'
                    then case when vp.operacion='cobro' then vp.monto else -vp.monto end
                else 0
            end
        ),0),
        count(distinct vp.venta_id) filter (where vp.operacion='cobro')::integer
      into v_ventas_total, v_ventas_efectivo, v_tickets
      from public.venta_pagos vp
     where vp.caja_sesion_id = v_sesion.id;

    select
        coalesce(sum(cm.monto) filter (where cm.tipo='ingreso'),0),
        coalesce(sum(cm.monto) filter (where cm.tipo='retiro'),0)
      into v_ingresos, v_retiros
      from public.caja_movimientos cm
     where cm.sesion_id = v_sesion.id;

    v_esperado :=
        v_sesion.fondo_inicial
        + v_ventas_efectivo
        + v_ingresos
        - v_retiros;

    v_diferencia := round(p_efectivo_declarado - v_esperado,2);

    update public.cajas_sesiones
       set estado = 'cerrada',
           cerrada_en = now(),
           efectivo_declarado = round(p_efectivo_declarado,2),
           efectivo_esperado = round(v_esperado,2),
           diferencia = v_diferencia,
           ventas_total = round(v_ventas_total,2),
           ventas_efectivo = round(v_ventas_efectivo,2),
           ingresos_total = round(v_ingresos,2),
           retiros_total = round(v_retiros,2),
           tickets = v_tickets,
           nota_cierre = nullif(trim(coalesce(p_nota,'')),''),
           actualizado = now()
     where id = v_sesion.id
     returning * into v_sesion;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'caja_cerrada',
        'cajas_sesiones',
        v_sesion.id,
        jsonb_build_object(
            'efectivo_esperado',v_sesion.efectivo_esperado,
            'efectivo_declarado',v_sesion.efectivo_declarado,
            'diferencia',v_sesion.diferencia,
            'ventas_total',v_sesion.ventas_total,
            'tickets',v_sesion.tickets
        )
    );

    return jsonb_build_object(
        'ok',true,
        'sesion',to_jsonb(v_sesion)
    );
end;
$$;

revoke all on function public.cerrar_caja_v1(uuid,numeric,text) from public;
grant execute on function public.cerrar_caja_v1(uuid,numeric,text) to authenticated;

notify pgrst, 'reload schema';

commit;
