-- ============================================================
-- Vendify v2.29 — Inventario profesional
--
-- Ejecutar DESPUÉS de multisucursal / ventas / stock inteligente.
--
-- Incluye:
-- - motivos y detalles para movimientos de stock
-- - ajustes auditados
-- - conteo físico parcial o completo
-- - historial de movimientos por sucursal
-- - transferencias con motivo
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 1. AMPLIAR MOVIMIENTOS
-- ============================================================

alter table public.movimientos
    add column if not exists motivo text,
    add column if not exists detalle jsonb not null default '{}'::jsonb;

-- Mantener cualquier tipo que ya exista y sumar los del inventario.
do $$
declare
    v_tipos text;
begin
    select string_agg(quote_literal(tipo), ', ' order by tipo)
      into v_tipos
      from (
          select distinct tipo::text
          from public.movimientos
          where tipo is not null

          union select 'venta'
          union select 'ingreso'
          union select 'ajuste'
          union select 'rotura'
          union select 'vencimiento'
          union select 'perdida'
          union select 'inventario'
          union select 'transferencia_salida'
          union select 'transferencia_entrada'
          union select 'devolucion'
      ) t;

    alter table public.movimientos
        drop constraint if exists movimientos_tipo_check;

    execute format(
        'alter table public.movimientos
         add constraint movimientos_tipo_check
         check (tipo in (%s))',
        v_tipos
    );
end $$;

create index if not exists movimientos_inventario_sucursal_fecha_idx
    on public.movimientos(sucursal_id, creado desc);

create index if not exists movimientos_inventario_producto_idx
    on public.movimientos(producto_id, creado desc);

-- ============================================================
-- 2. CONTEOS FÍSICOS
-- ============================================================

create table if not exists public.inventario_conteos (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,

    nota text,
    productos_contados integer not null default 0,
    productos_ajustados integer not null default 0,
    diferencia_positiva integer not null default 0,
    diferencia_negativa integer not null default 0,

    creado timestamptz not null default now()
);

create table if not exists public.inventario_conteo_items (
    id uuid primary key default gen_random_uuid(),
    conteo_id uuid not null references public.inventario_conteos(id) on delete cascade,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    producto_id uuid not null references public.productos(id) on delete restrict,

    stock_sistema integer not null check (stock_sistema >= 0),
    stock_contado integer not null check (stock_contado >= 0),
    diferencia integer not null,

    creado timestamptz not null default now(),

    unique(conteo_id, producto_id)
);

create index if not exists inventario_conteos_sucursal_idx
    on public.inventario_conteos(sucursal_id, creado desc);

create index if not exists inventario_conteo_items_producto_idx
    on public.inventario_conteo_items(producto_id, creado desc);

alter table public.inventario_conteos enable row level security;
alter table public.inventario_conteo_items enable row level security;

drop policy if exists "inventario_conteos_select_miembros"
    on public.inventario_conteos;

create policy "inventario_conteos_select_miembros"
on public.inventario_conteos
for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "inventario_conteo_items_select_miembros"
    on public.inventario_conteo_items;

create policy "inventario_conteo_items_select_miembros"
on public.inventario_conteo_items
for select
using (public.es_miembro_negocio(negocio_id));

-- ============================================================
-- 3. AJUSTE MANUAL AUDITADO
-- ============================================================

create or replace function public.ajustar_stock_inventario_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_modo text,
    p_cantidad integer,
    p_motivo text,
    p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_anterior integer;
    v_nuevo integer;
    v_delta integer;
    v_tipo text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para modificar inventario';
    end if;

    if p_modo not in ('sumar','restar','establecer') then
        raise exception 'Operación de stock inválida';
    end if;

    if p_cantidad is null or p_cantidad < 0 then
        raise exception 'Cantidad inválida';
    end if;

    if p_motivo not in (
        'reposicion','correccion','rotura','vencimiento','perdida','inventario'
    ) then
        raise exception 'Motivo de inventario inválido';
    end if;

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if not found then
        raise exception 'Producto inexistente';
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

    select *
      into v_stock
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if not found then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(v_producto.stock_minimo,0),0)
        )
        returning * into v_stock;
    end if;

    v_anterior := v_stock.stock;

    if p_modo = 'sumar' then
        v_nuevo := v_anterior + p_cantidad;
    elsif p_modo = 'restar' then
        v_nuevo := v_anterior - p_cantidad;
    else
        v_nuevo := p_cantidad;
    end if;

    if v_nuevo < 0 then
        raise exception 'Stock insuficiente. Disponible: %', v_anterior;
    end if;

    v_delta := v_nuevo - v_anterior;

    if v_delta = 0 then
        return jsonb_build_object(
            'ok', true,
            'stock', v_anterior,
            'delta', 0,
            'sin_cambios', true
        );
    end if;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_stock.id;

    v_tipo :=
        case p_motivo
            when 'reposicion' then 'ingreso'
            when 'rotura' then 'rotura'
            when 'vencimiento' then 'vencimiento'
            when 'perdida' then 'perdida'
            when 'inventario' then 'inventario'
            else 'ajuste'
        end;

    insert into public.movimientos(
        user_id,
        negocio_id,
        sucursal_id,
        producto_id,
        producto_nombre,
        tipo,
        delta,
        stock_resultante,
        motivo,
        detalle
    )
    values(
        auth.uid(),
        v_negocio_id,
        p_sucursal_id,
        v_producto.id,
        v_producto.nombre,
        v_tipo,
        v_delta,
        v_nuevo,
        case p_motivo
            when 'reposicion' then 'Reposición / ingreso'
            when 'correccion' then 'Corrección de stock'
            when 'rotura' then 'Rotura'
            when 'vencimiento' then 'Vencimiento'
            when 'perdida' then 'Pérdida / merma'
            when 'inventario' then 'Conteo físico'
            else p_motivo
        end,
        jsonb_build_object(
            'modo', p_modo,
            'stock_anterior', v_anterior,
            'stock_nuevo', v_nuevo,
            'nota', nullif(trim(coalesce(p_nota,'')),'')
        )
    );

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'stock_ajustado',
        'productos',
        v_producto.id,
        jsonb_build_object(
            'sucursal_id',p_sucursal_id,
            'motivo',p_motivo,
            'stock_anterior',v_anterior,
            'stock_nuevo',v_nuevo,
            'delta',v_delta
        )
    );

    return jsonb_build_object(
        'ok', true,
        'stock', v_nuevo,
        'stock_anterior', v_anterior,
        'delta', v_delta,
        'tipo', v_tipo
    );
end;
$$;

revoke all on function public.ajustar_stock_inventario_v1(uuid,uuid,text,integer,text,text) from public;
grant execute on function public.ajustar_stock_inventario_v1(uuid,uuid,text,integer,text,text) to authenticated;

-- ============================================================
-- 4. CONTEO FÍSICO ATÓMICO
-- ============================================================

create or replace function public.aplicar_conteo_fisico_v1(
    p_sucursal_id uuid,
    p_items jsonb,
    p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_conteo public.inventario_conteos;
    v_item record;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_contado integer;
    v_anterior integer;
    v_delta integer;
    v_contados integer := 0;
    v_ajustados integer := 0;
    v_pos integer := 0;
    v_neg integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para realizar conteos';
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
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'Ingresá al menos un producto contado';
    end if;

    insert into public.inventario_conteos(
        negocio_id,sucursal_id,user_id,nota
    )
    values(
        v_negocio_id,
        p_sucursal_id,
        auth.uid(),
        nullif(trim(coalesce(p_nota,'')),'')
    )
    returning * into v_conteo;

    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            (x->>'stock_contado')::integer as stock_contado
        from jsonb_array_elements(p_items) x
    loop
        v_contado := v_item.stock_contado;

        if v_contado is null or v_contado < 0 then
            raise exception 'Cantidad contada inválida';
        end if;

        select *
          into v_producto
          from public.productos p
         where p.id = v_item.producto_id
           and p.negocio_id = v_negocio_id;

        if not found then
            raise exception 'Producto inválido en el conteo';
        end if;

        select *
          into v_stock
          from public.producto_stock_sucursal ps
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = p_sucursal_id
           and ps.producto_id = v_producto.id
         for update;

        if not found then
            insert into public.producto_stock_sucursal(
                negocio_id,sucursal_id,producto_id,stock,stock_minimo
            )
            values(
                v_negocio_id,p_sucursal_id,v_producto.id,0,
                greatest(coalesce(v_producto.stock_minimo,0),0)
            )
            returning * into v_stock;
        end if;

        v_anterior := v_stock.stock;
        v_delta := v_contado - v_anterior;

        insert into public.inventario_conteo_items(
            conteo_id,
            negocio_id,
            sucursal_id,
            producto_id,
            stock_sistema,
            stock_contado,
            diferencia
        )
        values(
            v_conteo.id,
            v_negocio_id,
            p_sucursal_id,
            v_producto.id,
            v_anterior,
            v_contado,
            v_delta
        );

        v_contados := v_contados + 1;

        if v_delta <> 0 then
            update public.producto_stock_sucursal
               set stock = v_contado,
                   actualizado = now()
             where id = v_stock.id;

            insert into public.movimientos(
                user_id,
                negocio_id,
                sucursal_id,
                producto_id,
                producto_nombre,
                tipo,
                delta,
                stock_resultante,
                motivo,
                detalle
            )
            values(
                auth.uid(),
                v_negocio_id,
                p_sucursal_id,
                v_producto.id,
                v_producto.nombre,
                'inventario',
                v_delta,
                v_contado,
                'Conteo físico',
                jsonb_build_object(
                    'conteo_id',v_conteo.id,
                    'stock_sistema',v_anterior,
                    'stock_contado',v_contado,
                    'nota',nullif(trim(coalesce(p_nota,'')),'')
                )
            );

            v_ajustados := v_ajustados + 1;

            if v_delta > 0 then
                v_pos := v_pos + v_delta;
            else
                v_neg := v_neg + abs(v_delta);
            end if;
        end if;
    end loop;

    update public.inventario_conteos
       set productos_contados = v_contados,
           productos_ajustados = v_ajustados,
           diferencia_positiva = v_pos,
           diferencia_negativa = v_neg
     where id = v_conteo.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'conteo_fisico_aplicado',
        'inventario_conteos',
        v_conteo.id,
        jsonb_build_object(
            'sucursal_id',p_sucursal_id,
            'productos_contados',v_contados,
            'productos_ajustados',v_ajustados,
            'diferencia_positiva',v_pos,
            'diferencia_negativa',v_neg
        )
    );

    return jsonb_build_object(
        'ok',true,
        'conteo_id',v_conteo.id,
        'productos_contados',v_contados,
        'productos_ajustados',v_ajustados,
        'diferencia_positiva',v_pos,
        'diferencia_negativa',v_neg
    );
end;
$$;

revoke all on function public.aplicar_conteo_fisico_v1(uuid,jsonb,text) from public;
grant execute on function public.aplicar_conteo_fisico_v1(uuid,jsonb,text) to authenticated;

-- ============================================================
-- 5. HISTORIAL DE MOVIMIENTOS
-- ============================================================

create or replace function public.listar_movimientos_inventario_v1(
    p_sucursal_id uuid,
    p_limit integer default 100
)
returns table (
    id uuid,
    producto_id uuid,
    producto_nombre text,
    tipo text,
    delta integer,
    stock_resultante integer,
    motivo text,
    detalle jsonb,
    usuario_id uuid,
    usuario_nombre text,
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
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    return query
    select
        m.id,
        m.producto_id,
        m.producto_nombre,
        m.tipo,
        m.delta,
        m.stock_resultante,
        coalesce(m.motivo,'')::text,
        coalesce(m.detalle,'{}'::jsonb),
        m.user_id,
        coalesce(
            e.nombre,
            split_part(u.email,'@',1),
            'Usuario'
        )::text,
        m.creado
    from public.movimientos m
    left join auth.users u
      on u.id = m.user_id
    left join public.empleados e
      on e.user_id = m.user_id
     and e.negocio_id = m.negocio_id
    where m.negocio_id = v_negocio_id
      and m.sucursal_id = p_sucursal_id
    order by m.creado desc
    limit greatest(1, least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.listar_movimientos_inventario_v1(uuid,integer) from public;
grant execute on function public.listar_movimientos_inventario_v1(uuid,integer) to authenticated;

-- ============================================================
-- 6. TRANSFERENCIA V2 CON MOTIVO
-- ============================================================

create or replace function public.transferir_stock_v2(
    p_producto_id uuid,
    p_origen_id uuid,
    p_destino_id uuid,
    p_cantidad integer,
    p_motivo text default 'Transferencia entre sucursales'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_origen public.producto_stock_sucursal;
    v_destino public.producto_stock_sucursal;
    v_origen_nombre text;
    v_destino_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para transferir stock';
    end if;

    if p_origen_id = p_destino_id then
        raise exception 'Origen y destino deben ser distintos';
    end if;

    if p_cantidad is null or p_cantidad <= 0 then
        raise exception 'Cantidad inválida';
    end if;

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if not found then
        raise exception 'Producto inexistente';
    end if;

    select s.nombre
      into v_origen_nombre
      from public.sucursales s
     where s.id = p_origen_id
       and s.negocio_id = v_negocio_id
       and s.activa = true;

    select s.nombre
      into v_destino_nombre
      from public.sucursales s
     where s.id = p_destino_id
       and s.negocio_id = v_negocio_id
       and s.activa = true;

    if v_origen_nombre is null or v_destino_nombre is null then
        raise exception 'Sucursal inválida';
    end if;

    -- Lock consistente de las dos filas.
    perform 1
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.producto_id = p_producto_id
       and ps.sucursal_id in (p_origen_id,p_destino_id)
     order by ps.sucursal_id
     for update;

    select *
      into v_origen
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.producto_id = p_producto_id
       and ps.sucursal_id = p_origen_id;

    select *
      into v_destino
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.producto_id = p_producto_id
       and ps.sucursal_id = p_destino_id;

    if v_origen.id is null or v_destino.id is null then
        raise exception 'No se encontró el producto en ambas sucursales';
    end if;

    if v_origen.stock < p_cantidad then
        raise exception 'Stock insuficiente en origen. Disponible: %', v_origen.stock;
    end if;

    update public.producto_stock_sucursal
       set stock = stock - p_cantidad,
           actualizado = now()
     where id = v_origen.id
     returning * into v_origen;

    update public.producto_stock_sucursal
       set stock = stock + p_cantidad,
           actualizado = now()
     where id = v_destino.id
     returning * into v_destino;

    insert into public.movimientos(
        user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
        tipo,delta,stock_resultante,motivo,detalle
    )
    values
    (
        auth.uid(),v_negocio_id,p_origen_id,v_producto.id,v_producto.nombre,
        'transferencia_salida',-p_cantidad,v_origen.stock,
        nullif(trim(coalesce(p_motivo,'')),''),
        jsonb_build_object(
            'origen_id',p_origen_id,
            'origen',v_origen_nombre,
            'destino_id',p_destino_id,
            'destino',v_destino_nombre
        )
    ),
    (
        auth.uid(),v_negocio_id,p_destino_id,v_producto.id,v_producto.nombre,
        'transferencia_entrada',p_cantidad,v_destino.stock,
        nullif(trim(coalesce(p_motivo,'')),''),
        jsonb_build_object(
            'origen_id',p_origen_id,
            'origen',v_origen_nombre,
            'destino_id',p_destino_id,
            'destino',v_destino_nombre
        )
    );

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'stock_transferido',
        'productos',
        v_producto.id,
        jsonb_build_object(
            'origen_id',p_origen_id,
            'destino_id',p_destino_id,
            'cantidad',p_cantidad,
            'motivo',nullif(trim(coalesce(p_motivo,'')),'')
        )
    );

    return jsonb_build_object(
        'ok',true,
        'stock_origen',v_origen.stock,
        'stock_destino',v_destino.stock
    );
end;
$$;

revoke all on function public.transferir_stock_v2(uuid,uuid,uuid,integer,text) from public;
grant execute on function public.transferir_stock_v2(uuid,uuid,uuid,integer,text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- Verificación opcional
-- ============================================================
--
-- select tipo, count(*)
-- from public.movimientos
-- group by tipo
-- order by tipo;
--
-- select *
-- from public.inventario_conteos
-- order by creado desc;
-- ============================================================
