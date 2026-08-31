-- ============================================================
-- VENDIFY v2.30.1 — SECURITY FIX3 ALL-IN-ONE
--
-- Ejecutar ESTE archivo completo una sola vez.
--
-- ETAPA 1: instala/actualiza Compras + Proveedores v2.30
-- ETAPA 2: aplica Security Hardening v2.30.1
--
-- Es intencional que existan dos transacciones BEGIN/COMMIT:
-- cada etapa es independiente y re-ejecutable.
-- ============================================================



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ETAPA 1 — COMPRAS Y PROVEEDORES
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- Vendify v2.30 — Compras y proveedores
--
-- Requiere:
-- - multisucursal
-- - inventario profesional
--
-- Incluye:
-- - proveedores
-- - compras y detalle
-- - historial de costos
-- - recepción de mercadería -> incrementa stock
-- - actualización del último costo
-- - corrección física por scanner para ventas con stock desfasado
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 1. PROVEEDORES
-- ============================================================

create table if not exists public.proveedores (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,

    nombre text not null,
    cuit text,
    contacto text,
    telefono text,
    email text,
    direccion text,
    notas text,

    activo boolean not null default true,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

create unique index if not exists proveedores_nombre_negocio_uidx
    on public.proveedores(negocio_id, lower(nombre))
    where activo = true;

create index if not exists proveedores_negocio_idx
    on public.proveedores(negocio_id, activo, nombre);

alter table public.proveedores enable row level security;

drop policy if exists "proveedores_select_miembros" on public.proveedores;

create policy "proveedores_select_miembros"
on public.proveedores
for select
using (public.es_miembro_negocio(negocio_id));

-- ============================================================
-- 2. COMPRAS
-- ============================================================

create table if not exists public.compras (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    proveedor_id uuid not null references public.proveedores(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,

    numero_comprobante text,
    nota text,

    estado text not null default 'borrador'
        check (estado in ('borrador','recibida','anulada')),

    total numeric(14,2) not null default 0 check (total >= 0),

    recibida_en timestamptz,
    recibida_por uuid references auth.users(id) on delete set null,

    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

create index if not exists compras_negocio_sucursal_fecha_idx
    on public.compras(negocio_id, sucursal_id, creado desc);

create index if not exists compras_proveedor_idx
    on public.compras(proveedor_id, creado desc);

alter table public.compras enable row level security;

drop policy if exists "compras_select_miembros" on public.compras;

create policy "compras_select_miembros"
on public.compras
for select
using (public.es_miembro_negocio(negocio_id));

create table if not exists public.compra_items (
    id uuid primary key default gen_random_uuid(),
    compra_id uuid not null references public.compras(id) on delete cascade,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete restrict,

    producto_nombre text not null,
    cantidad integer not null check (cantidad > 0),
    costo_unitario numeric(14,2) not null check (costo_unitario >= 0),
    subtotal numeric(14,2) not null check (subtotal >= 0),

    creado timestamptz not null default now(),

    unique(compra_id, producto_id)
);

create index if not exists compra_items_producto_idx
    on public.compra_items(producto_id, creado desc);

alter table public.compra_items enable row level security;

drop policy if exists "compra_items_select_miembros" on public.compra_items;

create policy "compra_items_select_miembros"
on public.compra_items
for select
using (public.es_miembro_negocio(negocio_id));

-- ============================================================
-- 3. HISTORIAL DE COSTOS
-- ============================================================

create table if not exists public.producto_costos_historial (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    producto_id uuid not null references public.productos(id) on delete cascade,
    proveedor_id uuid references public.proveedores(id) on delete set null,
    compra_id uuid references public.compras(id) on delete set null,

    costo_anterior numeric(14,2) not null default 0,
    costo_nuevo numeric(14,2) not null default 0,

    user_id uuid references auth.users(id) on delete set null,
    creado timestamptz not null default now()
);

create index if not exists producto_costos_historial_producto_idx
    on public.producto_costos_historial(producto_id, creado desc);

alter table public.producto_costos_historial enable row level security;

drop policy if exists "costos_historial_select_supervisores"
    on public.producto_costos_historial;

create policy "costos_historial_select_supervisores"
on public.producto_costos_historial
for select
using (
    public.es_miembro_negocio(negocio_id)
    and public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

-- ============================================================
-- 4. MOVIMIENTOS: agregar tipo compra si falta
-- ============================================================

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
          union select 'compra'
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

-- ============================================================
-- 5. PROVEEDORES RPC
-- ============================================================

create or replace function public.listar_proveedores_v1()
returns table (
    id uuid,
    nombre text,
    cuit text,
    contacto text,
    telefono text,
    email text,
    direccion text,
    notas text,
    activo boolean,
    compras_recibidas bigint,
    total_comprado numeric,
    ultima_compra timestamptz
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
        p.id,
        p.nombre,
        p.cuit,
        p.contacto,
        p.telefono,
        p.email,
        p.direccion,
        p.notas,
        p.activo,
        count(c.id) filter (where c.estado = 'recibida')::bigint,
        coalesce(
            sum(c.total) filter (where c.estado = 'recibida'),
            0
        )::numeric,
        max(c.recibida_en) filter (where c.estado = 'recibida')
    from public.proveedores p
    left join public.compras c
      on c.proveedor_id = p.id
     and c.negocio_id = p.negocio_id
    where p.negocio_id = v_negocio_id
    group by p.id
    order by p.activo desc, p.nombre;
end;
$$;

revoke all on function public.listar_proveedores_v1() from public;
grant execute on function public.listar_proveedores_v1() to authenticated;

create or replace function public.guardar_proveedor_v1(
    p_id uuid,
    p_nombre text,
    p_cuit text default null,
    p_contacto text default null,
    p_telefono text default null,
    p_email text default null,
    p_direccion text default null,
    p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para administrar proveedores';
    end if;

    if nullif(trim(coalesce(p_nombre,'')),'') is null then
        return jsonb_build_object('ok',false,'message','El nombre es obligatorio');
    end if;

    if p_id is null then
        insert into public.proveedores(
            negocio_id,nombre,cuit,contacto,telefono,email,direccion,notas
        )
        values(
            v_negocio_id,
            trim(p_nombre),
            nullif(trim(coalesce(p_cuit,'')),''),
            nullif(trim(coalesce(p_contacto,'')),''),
            nullif(trim(coalesce(p_telefono,'')),''),
            nullif(trim(coalesce(p_email,'')),''),
            nullif(trim(coalesce(p_direccion,'')),''),
            nullif(trim(coalesce(p_notas,'')),'')
        )
        returning id into v_id;
    else
        update public.proveedores
           set nombre = trim(p_nombre),
               cuit = nullif(trim(coalesce(p_cuit,'')),''),
               contacto = nullif(trim(coalesce(p_contacto,'')),''),
               telefono = nullif(trim(coalesce(p_telefono,'')),''),
               email = nullif(trim(coalesce(p_email,'')),''),
               direccion = nullif(trim(coalesce(p_direccion,'')),''),
               notas = nullif(trim(coalesce(p_notas,'')),''),
               actualizado = now()
         where id = p_id
           and negocio_id = v_negocio_id
        returning id into v_id;

        if v_id is null then
            raise exception 'Proveedor inexistente';
        end if;
    end if;

    return jsonb_build_object('ok',true,'proveedor_id',v_id);
exception
    when unique_violation then
        return jsonb_build_object(
            'ok',false,
            'message','Ya existe un proveedor activo con ese nombre'
        );
end;
$$;

revoke all on function public.guardar_proveedor_v1(uuid,text,text,text,text,text,text,text) from public;
grant execute on function public.guardar_proveedor_v1(uuid,text,text,text,text,text,text,text) to authenticated;

-- ============================================================
-- 6. COMPRAS RPC
-- ============================================================

create or replace function public.listar_compras_v1(
    p_sucursal_id uuid,
    p_limit integer default 150
)
returns table (
    id uuid,
    sucursal_id uuid,
    proveedor_id uuid,
    proveedor_nombre text,
    numero_comprobante text,
    nota text,
    estado text,
    total numeric,
    items_count bigint,
    recibida_en timestamptz,
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

    return query
    select
        c.id,
        c.sucursal_id,
        c.proveedor_id,
        p.nombre,
        c.numero_comprobante,
        c.nota,
        c.estado,
        c.total,
        count(ci.id)::bigint,
        c.recibida_en,
        c.creado
    from public.compras c
    join public.proveedores p on p.id = c.proveedor_id
    left join public.compra_items ci on ci.compra_id = c.id
    where c.negocio_id = v_negocio_id
      and c.sucursal_id = p_sucursal_id
    group by c.id, p.nombre
    order by c.creado desc
    limit greatest(1, least(coalesce(p_limit,150),500));
end;
$$;

revoke all on function public.listar_compras_v1(uuid,integer) from public;
grant execute on function public.listar_compras_v1(uuid,integer) to authenticated;

create or replace function public.obtener_compra_v1(
    p_compra_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_compra jsonb;
    v_items jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select to_jsonb(c)
      into v_compra
      from public.compras c
     where c.id = p_compra_id
       and c.negocio_id = v_negocio_id;

    if v_compra is null then
        raise exception 'Compra inexistente';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id',ci.id,
                'producto_id',ci.producto_id,
                'producto_nombre',ci.producto_nombre,
                'cantidad',ci.cantidad,
                'costo_unitario',ci.costo_unitario,
                'subtotal',ci.subtotal
            )
            order by ci.creado, ci.id
        ),
        '[]'::jsonb
    )
      into v_items
      from public.compra_items ci
     where ci.compra_id = p_compra_id
       and ci.negocio_id = v_negocio_id;

    return jsonb_build_object(
        'compra',v_compra,
        'items',v_items
    );
end;
$$;

revoke all on function public.obtener_compra_v1(uuid) from public;
grant execute on function public.obtener_compra_v1(uuid) to authenticated;

create or replace function public.guardar_compra_borrador_v1(
    p_compra_id uuid,
    p_sucursal_id uuid,
    p_proveedor_id uuid,
    p_numero_comprobante text,
    p_nota text,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_compra_id uuid;
    v_estado text;
    v_item record;
    v_producto public.productos;
    v_total numeric(14,2) := 0;
    v_qty integer;
    v_cost numeric(14,2);
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para registrar compras';
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

    if not exists (
        select 1
        from public.proveedores p
        where p.id = p_proveedor_id
          and p.negocio_id = v_negocio_id
          and p.activo = true
    ) then
        raise exception 'Proveedor inválido';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        return jsonb_build_object(
            'ok',false,
            'message','Agregá al menos un producto'
        );
    end if;

    if p_compra_id is null then
        insert into public.compras(
            negocio_id,sucursal_id,proveedor_id,user_id,
            numero_comprobante,nota,estado,total
        )
        values(
            v_negocio_id,p_sucursal_id,p_proveedor_id,auth.uid(),
            nullif(trim(coalesce(p_numero_comprobante,'')),''),
            nullif(trim(coalesce(p_nota,'')),''),
            'borrador',0
        )
        returning id into v_compra_id;
    else
        select c.estado
          into v_estado
          from public.compras c
         where c.id = p_compra_id
           and c.negocio_id = v_negocio_id
         for update;

        if v_estado is null then
            raise exception 'Compra inexistente';
        end if;

        if v_estado <> 'borrador' then
            raise exception 'Solo se pueden modificar compras en borrador';
        end if;

        v_compra_id := p_compra_id;

        update public.compras
           set sucursal_id = p_sucursal_id,
               proveedor_id = p_proveedor_id,
               numero_comprobante = nullif(trim(coalesce(p_numero_comprobante,'')),''),
               nota = nullif(trim(coalesce(p_nota,'')),''),
               actualizado = now()
         where id = v_compra_id;

        delete from public.compra_items
         where compra_id = v_compra_id;
    end if;

    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            (x->>'cantidad')::integer as cantidad,
            (x->>'costo_unitario')::numeric as costo_unitario
        from jsonb_array_elements(p_items) x
    loop
        v_qty := v_item.cantidad;
        v_cost := round(v_item.costo_unitario,2);

        if v_qty is null or v_qty <= 0 then
            raise exception 'Cantidad inválida en la compra';
        end if;

        if v_cost is null or v_cost < 0 then
            raise exception 'Costo inválido en la compra';
        end if;

        select *
          into v_producto
          from public.productos p
         where p.id = v_item.producto_id
           and p.negocio_id = v_negocio_id;

        if not found then
            raise exception 'Producto inválido en la compra';
        end if;

        insert into public.compra_items(
            compra_id,negocio_id,producto_id,producto_nombre,
            cantidad,costo_unitario,subtotal
        )
        values(
            v_compra_id,
            v_negocio_id,
            v_producto.id,
            v_producto.nombre,
            v_qty,
            v_cost,
            round(v_qty * v_cost,2)
        );

        v_total := v_total + round(v_qty * v_cost,2);
    end loop;

    update public.compras
       set total = round(v_total,2),
           actualizado = now()
     where id = v_compra_id;

    return jsonb_build_object(
        'ok',true,
        'compra_id',v_compra_id,
        'total',round(v_total,2)
    );
end;
$$;

revoke all on function public.guardar_compra_borrador_v1(uuid,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.guardar_compra_borrador_v1(uuid,uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.recibir_compra_v1(
    p_compra_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_compra public.compras;
    v_item public.compra_items;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_anterior integer;
    v_nuevo integer;
    v_costo_anterior numeric(14,2);
    v_unidades integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para recibir compras';
    end if;

    select *
      into v_compra
      from public.compras c
     where c.id = p_compra_id
       and c.negocio_id = v_negocio_id
     for update;

    if v_compra.id is null then
        raise exception 'Compra inexistente';
    end if;

    if v_compra.estado <> 'borrador' then
        raise exception 'La compra ya fue procesada';
    end if;

    if not exists (
        select 1 from public.compra_items ci
        where ci.compra_id = v_compra.id
    ) then
        raise exception 'La compra no tiene productos';
    end if;

    for v_item in
        select *
        from public.compra_items ci
        where ci.compra_id = v_compra.id
        order by ci.producto_id
    loop
        select *
          into v_producto
          from public.productos p
         where p.id = v_item.producto_id
           and p.negocio_id = v_negocio_id
         for update;

        if v_producto.id is null then
            raise exception 'Producto inexistente al recibir compra';
        end if;

        select *
          into v_stock
          from public.producto_stock_sucursal ps
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = v_compra.sucursal_id
           and ps.producto_id = v_producto.id
         for update;

        if v_stock.id is null then
            insert into public.producto_stock_sucursal(
                negocio_id,sucursal_id,producto_id,stock,stock_minimo
            )
            values(
                v_negocio_id,
                v_compra.sucursal_id,
                v_producto.id,
                0,
                greatest(coalesce(v_producto.stock_minimo,0),0)
            )
            returning * into v_stock;
        end if;

        v_anterior := v_stock.stock;
        v_nuevo := v_anterior + v_item.cantidad;
        v_costo_anterior := coalesce(v_producto.precio_compra,0);

        update public.producto_stock_sucursal
           set stock = v_nuevo,
               actualizado = now()
         where id = v_stock.id;

        update public.productos
           set precio_compra = v_item.costo_unitario,
               actualizado = now()
         where id = v_producto.id;

        insert into public.producto_costos_historial(
            negocio_id,sucursal_id,producto_id,proveedor_id,compra_id,
            costo_anterior,costo_nuevo,user_id
        )
        values(
            v_negocio_id,
            v_compra.sucursal_id,
            v_producto.id,
            v_compra.proveedor_id,
            v_compra.id,
            v_costo_anterior,
            v_item.costo_unitario,
            auth.uid()
        );

        insert into public.movimientos(
            user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
            tipo,delta,stock_resultante,motivo,detalle
        )
        values(
            auth.uid(),
            v_negocio_id,
            v_compra.sucursal_id,
            v_producto.id,
            v_producto.nombre,
            'compra',
            v_item.cantidad,
            v_nuevo,
            'Compra de mercadería',
            jsonb_build_object(
                'compra_id',v_compra.id,
                'proveedor_id',v_compra.proveedor_id,
                'cantidad',v_item.cantidad,
                'costo_unitario',v_item.costo_unitario,
                'costo_anterior',v_costo_anterior
            )
        );

        v_unidades := v_unidades + v_item.cantidad;
    end loop;

    update public.compras
       set estado = 'recibida',
           recibida_en = now(),
           recibida_por = auth.uid(),
           actualizado = now()
     where id = v_compra.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'compra_recibida',
        'compras',
        v_compra.id,
        jsonb_build_object(
            'sucursal_id',v_compra.sucursal_id,
            'proveedor_id',v_compra.proveedor_id,
            'total',v_compra.total,
            'unidades',v_unidades
        )
    );

    return jsonb_build_object(
        'ok',true,
        'compra_id',v_compra.id,
        'unidades_ingresadas',v_unidades,
        'total',v_compra.total
    );
end;
$$;

revoke all on function public.recibir_compra_v1(uuid) from public;
grant execute on function public.recibir_compra_v1(uuid) to authenticated;

create or replace function public.anular_compra_borrador_v1(
    p_compra_id uuid
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
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para anular compras';
    end if;

    update public.compras
       set estado = 'anulada',
           actualizado = now()
     where id = p_compra_id
       and negocio_id = v_negocio_id
       and estado = 'borrador';

    if not found then
        raise exception 'Solo se pueden anular compras en borrador';
    end if;

    return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.anular_compra_borrador_v1(uuid) from public;
grant execute on function public.anular_compra_borrador_v1(uuid) to authenticated;

-- ============================================================
-- 7. SCANNER COMO EVIDENCIA FÍSICA DE UNA UNIDAD
-- ============================================================

create or replace function public.confirmar_stock_por_scanner_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_stock_minimo_necesario integer
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

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_producto.id is null then
        raise exception 'Producto inexistente';
    end if;

    select *
      into v_stock
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if v_stock.id is null then
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

    if p_stock_minimo_necesario is null
       or p_stock_minimo_necesario <= v_anterior then
        return jsonb_build_object(
            'ok',true,
            'stock',v_anterior,
            'ajustado',false
        );
    end if;

    -- Cada lectura física solo puede justificar UNA unidad adicional.
    if p_stock_minimo_necesario > v_anterior + 1 then
        raise exception 'El scanner solo puede confirmar una unidad física por lectura';
    end if;

    v_nuevo := v_anterior + 1;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_stock.id;

    insert into public.movimientos(
        user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
        tipo,delta,stock_resultante,motivo,detalle
    )
    values(
        auth.uid(),
        v_negocio_id,
        p_sucursal_id,
        v_producto.id,
        v_producto.nombre,
        'ajuste',
        1,
        v_nuevo,
        'Corrección automática por escaneo físico',
        jsonb_build_object(
            'origen','scanner_venta',
            'stock_anterior',v_anterior,
            'stock_nuevo',v_nuevo
        )
    );

    return jsonb_build_object(
        'ok',true,
        'stock',v_nuevo,
        'ajustado',true
    );
end;
$$;

revoke all on function public.confirmar_stock_por_scanner_v1(uuid,uuid,integer) from public;
grant execute on function public.confirmar_stock_por_scanner_v1(uuid,uuid,integer) to authenticated;

notify pgrst, 'reload schema';

commit;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ETAPA 2 — SECURITY HARDENING
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- Vendify v2.30.1 — SECURITY HARDENING
--
-- Ejecutar DESPUÉS de las migraciones anteriores.
--
-- Objetivos:
--   * aislamiento multiempresa
--   * escrituras críticas solo por RPC
--   * costos ocultos a cashier
--   * categorías por negocio
--   * scanner endurecido
--   * RLS reconstruido en tablas críticas
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- A. CATEGORÍAS MULTIEMPRESA
-- ============================================================

alter table public.categorias
    add column if not exists negocio_id uuid
        references public.negocios(id) on delete cascade;

-- Backfill de categorías legacy basadas en user_id.
--
-- Se resuelve primero una membresía activa preferida por usuario
-- y luego se actualizan las categorías mediante un JOIN válido.
with membresia_preferida as (
    select distinct on (nm.user_id)
        nm.user_id,
        nm.negocio_id
    from public.negocio_miembros nm
    where nm.activo = true
    order by
        nm.user_id,
        case when nm.rol = 'owner' then 0 else 1 end,
        nm.creado,
        nm.negocio_id
)
update public.categorias c
   set negocio_id = mp.negocio_id
  from membresia_preferida mp
 where c.negocio_id is null
   and c.user_id = mp.user_id;

-- Limpiar duplicados legacy dentro del mismo negocio antes del índice único.
with categorias_duplicadas as (
    select
        c.id,
        row_number() over (
            partition by c.negocio_id, lower(trim(c.nombre))
            order by c.id
        ) as rn
    from public.categorias c
    where c.negocio_id is not null
)
delete from public.categorias c
using categorias_duplicadas d
where c.id = d.id
  and d.rn > 1;

create unique index if not exists categorias_negocio_nombre_uidx
    on public.categorias(negocio_id, lower(nombre))
    where negocio_id is not null;

-- ============================================================
-- B. CATÁLOGO SEGURO
-- ============================================================

create or replace function public.listar_productos_sucursal_seguro_v1(
    p_sucursal_id uuid
)
returns table (
    id uuid,
    nombre text,
    marca text,
    presentacion text,
    codigo_barras text,
    categoria text,
    precio_compra numeric,
    precio_venta numeric,
    stock integer,
    stock_minimo integer,
    foto text,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_rol text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select nm.rol
      into v_rol
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    if v_rol is null then
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

    return query
    select
        p.id,
        p.nombre,
        coalesce(p.marca,'')::text,
        coalesce(p.presentacion,'')::text,
        coalesce(p.codigo_barras,'')::text,
        coalesce(p.categoria,'')::text,

        -- Cashier puede vender pero no leer costos por API/DevTools.
        case
          when v_rol in ('owner','admin','manager')
          then coalesce(p.precio_compra,0)
          else 0::numeric
        end,

        coalesce(p.precio_venta,0),
        coalesce(ps.stock,0)::integer,
        coalesce(ps.stock_minimo,0)::integer,
        p.foto,
        p.creado

    from public.productos p
    join public.producto_stock_sucursal ps
      on ps.producto_id = p.id
     and ps.sucursal_id = p_sucursal_id
     and ps.negocio_id = v_negocio_id
    where p.negocio_id = v_negocio_id
    order by p.nombre;
end;
$$;

revoke all
on function public.listar_productos_sucursal_seguro_v1(uuid)
from public;

grant execute
on function public.listar_productos_sucursal_seguro_v1(uuid)
to authenticated;

-- ============================================================
-- C. CATEGORÍAS SEGURAS
-- ============================================================

create or replace function public.listar_categorias_seguras_v1()
returns table(nombre text)
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
    select c.nombre
      from public.categorias c
     where c.negocio_id = v_negocio_id
     order by c.nombre;
end;
$$;

revoke all on function public.listar_categorias_seguras_v1() from public;
grant execute on function public.listar_categorias_seguras_v1() to authenticated;

create or replace function public.inicializar_categorias_seguras_v1(
    p_nombres text[]
)
returns table(nombre text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para administrar categorías';
    end if;

    if not exists (
        select 1 from public.categorias c
        where c.negocio_id = v_negocio_id
    ) then
        foreach v_nombre in array coalesce(p_nombres, array[]::text[])
        loop
            if nullif(trim(v_nombre),'') is not null then
                insert into public.categorias(
                    negocio_id,user_id,nombre
                )
                values(
                    v_negocio_id,auth.uid(),trim(v_nombre)
                )
                on conflict do nothing;
            end if;
        end loop;
    end if;

    return query
    select c.nombre
      from public.categorias c
     where c.negocio_id = v_negocio_id
     order by c.nombre;
end;
$$;

revoke all on function public.inicializar_categorias_seguras_v1(text[]) from public;
grant execute on function public.inicializar_categorias_seguras_v1(text[]) to authenticated;

create or replace function public.guardar_categoria_segura_v1(
    p_nombre text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para administrar categorías';
    end if;

    v_nombre := nullif(trim(coalesce(p_nombre,'')),'');

    if v_nombre is null then
        return jsonb_build_object('ok',false,'message','Nombre inválido');
    end if;

    insert into public.categorias(
        negocio_id,user_id,nombre
    )
    values(
        v_negocio_id,auth.uid(),v_nombre
    )
    on conflict do nothing;

    return jsonb_build_object('ok',true,'nombre',v_nombre);
end;
$$;

revoke all on function public.guardar_categoria_segura_v1(text) from public;
grant execute on function public.guardar_categoria_segura_v1(text) to authenticated;

create or replace function public.eliminar_categoria_segura_v1(
    p_nombre text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para administrar categorías';
    end if;

    v_nombre := nullif(trim(coalesce(p_nombre,'')),'');
    if v_nombre is null then
        return jsonb_build_object('ok',false,'message','Categoría inválida');
    end if;

    update public.productos
       set categoria = '',
           actualizado = now()
     where negocio_id = v_negocio_id
       and categoria = v_nombre;

    delete from public.categorias
     where negocio_id = v_negocio_id
       and lower(nombre) = lower(v_nombre);

    return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.eliminar_categoria_segura_v1(text) from public;
grant execute on function public.eliminar_categoria_segura_v1(text) to authenticated;

-- ============================================================
-- D. PRODUCTOS: ESCRITURA POR RPC
-- ============================================================

create or replace function public.guardar_producto_seguro_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_nombre text,
    p_marca text,
    p_presentacion text,
    p_codigo_barras text,
    p_categoria text,
    p_precio_compra numeric,
    p_precio_venta numeric,
    p_stock integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_stock_actual integer := 0;
    v_stock_resultante integer := 0;
    v_result jsonb;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para modificar productos';
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

    v_nombre := nullif(trim(coalesce(p_nombre,'')),'');
    if v_nombre is null then
        return jsonb_build_object(
            'ok',false,
            'message','El nombre es obligatorio'
        );
    end if;

    if coalesce(p_stock,0) < 0
       or coalesce(p_precio_compra,0) < 0
       or coalesce(p_precio_venta,0) < 0 then
        return jsonb_build_object(
            'ok',false,
            'message','Stock y precios no pueden ser negativos'
        );
    end if;

    if nullif(trim(coalesce(p_codigo_barras,'')),'') is not null
       and exists (
          select 1
            from public.productos p
           where p.negocio_id = v_negocio_id
             and p.codigo_barras = trim(p_codigo_barras)
             and (p_producto_id is null or p.id <> p_producto_id)
       ) then
        return jsonb_build_object(
            'ok',false,
            'message','Ese código de barras ya está cargado'
        );
    end if;

    if p_producto_id is null then
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
            coalesce(trim(p_marca),''),
            coalesce(trim(p_presentacion),''),
            nullif(trim(coalesce(p_codigo_barras,'')),''),
            coalesce(trim(p_categoria),''),
            round(coalesce(p_precio_compra,0),2),
            round(coalesce(p_precio_venta,0),2),
            0,
            0
        )
        returning * into v_producto;

        v_result := public.establecer_stock_inicial_v1(
            v_producto.id,
            p_sucursal_id,
            coalesce(p_stock,0),
            0
        );

        v_stock_resultante := coalesce(
            (v_result->>'stock')::integer,
            p_stock,
            0
        );

        insert into public.audit_log(
            negocio_id,user_id,accion,entidad,entidad_id,detalle
        )
        values(
            v_negocio_id,
            auth.uid(),
            'producto_creado',
            'productos',
            v_producto.id,
            jsonb_build_object(
                'sucursal_id',p_sucursal_id,
                'stock_inicial',v_stock_resultante
            )
        );

    else
        select *
          into v_producto
          from public.productos p
         where p.id = p_producto_id
           and p.negocio_id = v_negocio_id
         for update;

        if v_producto.id is null then
            raise exception 'Producto inexistente';
        end if;

        select coalesce(ps.stock,0)
          into v_stock_actual
          from public.producto_stock_sucursal ps
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = p_sucursal_id
           and ps.producto_id = v_producto.id;

        update public.productos
           set nombre = v_nombre,
               marca = coalesce(trim(p_marca),''),
               presentacion = coalesce(trim(p_presentacion),''),
               codigo_barras = nullif(trim(coalesce(p_codigo_barras,'')),''),
               categoria = coalesce(trim(p_categoria),''),
               precio_compra = round(coalesce(p_precio_compra,0),2),
               precio_venta = round(coalesce(p_precio_venta,0),2),
               actualizado = now()
         where id = v_producto.id
        returning * into v_producto;

        if coalesce(p_stock,0) <> coalesce(v_stock_actual,0) then
            v_result := public.ajustar_stock_inventario_v1(
                v_producto.id,
                p_sucursal_id,
                'establecer',
                coalesce(p_stock,0),
                'correccion',
                'Cambio desde edición de producto'
            );

            v_stock_resultante := coalesce(
                (v_result->>'stock')::integer,
                p_stock,
                0
            );
        else
            v_stock_resultante := coalesce(v_stock_actual,0);
        end if;

        insert into public.audit_log(
            negocio_id,user_id,accion,entidad,entidad_id,detalle
        )
        values(
            v_negocio_id,
            auth.uid(),
            'producto_actualizado',
            'productos',
            v_producto.id,
            jsonb_build_object(
                'sucursal_id',p_sucursal_id
            )
        );
    end if;

    return jsonb_build_object(
        'ok',true,
        'producto',
        to_jsonb(v_producto)
        || jsonb_build_object(
            'stock',v_stock_resultante,
            'stock_minimo',0
        )
    );

exception
    when unique_violation then
        return jsonb_build_object(
            'ok',false,
            'message','El producto o código de barras ya existe'
        );
end;
$$;

revoke all on function public.guardar_producto_seguro_v1(
    uuid,uuid,text,text,text,text,text,numeric,numeric,integer
) from public;

grant execute on function public.guardar_producto_seguro_v1(
    uuid,uuid,text,text,text,text,text,numeric,numeric,integer
) to authenticated;

create or replace function public.eliminar_producto_seguro_v1(
    p_producto_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para eliminar productos';
    end if;

    select p.nombre
      into v_nombre
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_nombre is null then
        return jsonb_build_object(
            'ok',false,
            'message','Producto inexistente'
        );
    end if;

    delete from public.productos
     where id = p_producto_id
       and negocio_id = v_negocio_id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'producto_eliminado',
        'productos',
        p_producto_id,
        jsonb_build_object('nombre',v_nombre)
    );

    return jsonb_build_object('ok',true);

exception
    when foreign_key_violation then
        return jsonb_build_object(
            'ok',false,
            'message',
            'El producto tiene registros históricos y no puede eliminarse físicamente'
        );
end;
$$;

revoke all on function public.eliminar_producto_seguro_v1(uuid) from public;
grant execute on function public.eliminar_producto_seguro_v1(uuid) to authenticated;

create or replace function public.eliminar_todos_productos_seguro_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_count integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'Solo Propietario o Administrador pueden eliminar todo el catálogo';
    end if;

    select count(*) into v_count
      from public.productos p
     where p.negocio_id = v_negocio_id;

    delete from public.productos
     where negocio_id = v_negocio_id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'catalogo_eliminado',
        'productos',
        jsonb_build_object('cantidad',v_count)
    );

    return jsonb_build_object('ok',true,'eliminados',v_count);

exception
    when foreign_key_violation then
        return jsonb_build_object(
            'ok',false,
            'message',
            'Hay productos vinculados a registros históricos. No se eliminó el catálogo.'
        );
end;
$$;

revoke all on function public.eliminar_todos_productos_seguro_v1() from public;
grant execute on function public.eliminar_todos_productos_seguro_v1() to authenticated;

create or replace function public.importar_productos_seguro_v1(
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
    v_nombre text;
    v_categoria text;
    v_importados integer := 0;
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

    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        return jsonb_build_object('ok',false,'message','Catálogo inválido');
    end if;

    for v_item in
        select *
        from jsonb_to_recordset(p_items)
        as x(
            nombre text,
            marca text,
            presentacion text,
            categoria text
        )
    loop
        v_nombre := nullif(trim(coalesce(v_item.nombre,'')),'');
        v_categoria := nullif(trim(coalesce(v_item.categoria,'')),'');

        if v_nombre is null then
            continue;
        end if;

        if exists (
            select 1
              from public.productos p
             where p.negocio_id = v_negocio_id
               and lower(p.nombre) = lower(v_nombre)
        ) then
            continue;
        end if;

        if v_categoria is not null then
            insert into public.categorias(
                negocio_id,user_id,nombre
            )
            values(
                v_negocio_id,auth.uid(),v_categoria
            )
            on conflict do nothing;
        end if;

        insert into public.productos(
            negocio_id,user_id,nombre,marca,presentacion,
            codigo_barras,categoria,precio_compra,precio_venta,
            stock,stock_minimo
        )
        values(
            v_negocio_id,
            auth.uid(),
            v_nombre,
            coalesce(v_item.marca,''),
            coalesce(v_item.presentacion,''),
            null,
            coalesce(v_categoria,''),
            0,0,0,0
        );

        v_importados := v_importados + 1;
    end loop;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'catalogo_importado',
        'productos',
        jsonb_build_object(
            'cantidad',v_importados,
            'sucursal_id',p_sucursal_id
        )
    );

    return jsonb_build_object(
        'ok',true,
        'importados',v_importados
    );
end;
$$;

revoke all on function public.importar_productos_seguro_v1(uuid,jsonb) from public;
grant execute on function public.importar_productos_seguro_v1(uuid,jsonb) to authenticated;

-- ============================================================
-- E. SCANNER ENDURECIDO
-- ============================================================

create table if not exists public.scanner_stock_rate_limit (
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,

    ventana_inicio timestamptz not null default now(),
    correcciones integer not null default 0,
    actualizado timestamptz not null default now(),

    primary key (negocio_id,sucursal_id,user_id)
);

alter table public.scanner_stock_rate_limit enable row level security;

revoke all on table public.scanner_stock_rate_limit from anon, authenticated;

create or replace function public.confirmar_stock_por_scanner_v2(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_stock_minimo_necesario integer
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
    v_rate public.scanner_stock_rate_limit;
    v_anterior integer;
    v_nuevo integer;
    v_count integer;
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
          from public.cajas_sesiones cs
         where cs.negocio_id = v_negocio_id
           and cs.sucursal_id = p_sucursal_id
           and cs.user_id = auth.uid()
           and cs.estado = 'abierta'
    ) then
        raise exception 'Abrí tu caja antes de usar una corrección automática por scanner';
    end if;

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_producto.id is null then
        raise exception 'Producto inexistente';
    end if;

    select *
      into v_stock
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if v_stock.id is null then
        raise exception 'Stock de sucursal inexistente';
    end if;

    v_anterior := v_stock.stock;

    if p_stock_minimo_necesario is null
       or p_stock_minimo_necesario <= v_anterior then
        return jsonb_build_object(
            'ok',true,
            'stock',v_anterior,
            'ajustado',false
        );
    end if;

    -- Una lectura física solamente justifica +1.
    if p_stock_minimo_necesario <> v_anterior + 1 then
        raise exception 'El scanner solo puede confirmar una unidad física por lectura';
    end if;

    insert into public.scanner_stock_rate_limit(
        negocio_id,sucursal_id,user_id,
        ventana_inicio,correcciones,actualizado
    )
    values(
        v_negocio_id,p_sucursal_id,auth.uid(),
        now(),0,now()
    )
    on conflict (negocio_id,sucursal_id,user_id) do nothing;

    select *
      into v_rate
      from public.scanner_stock_rate_limit s
     where s.negocio_id = v_negocio_id
       and s.sucursal_id = p_sucursal_id
       and s.user_id = auth.uid()
     for update;

    if v_rate.ventana_inicio < now() - interval '5 minutes' then
        update public.scanner_stock_rate_limit
           set ventana_inicio = now(),
               correcciones = 0,
               actualizado = now()
         where negocio_id = v_negocio_id
           and sucursal_id = p_sucursal_id
           and user_id = auth.uid();

        v_rate.correcciones := 0;
    end if;

    if v_rate.correcciones >= 30 then
        insert into public.audit_log(
            negocio_id,user_id,accion,entidad,entidad_id,detalle
        )
        values(
            v_negocio_id,
            auth.uid(),
            'scanner_rate_limit',
            'productos',
            p_producto_id,
            jsonb_build_object(
                'sucursal_id',p_sucursal_id,
                'correcciones_5m',v_rate.correcciones
            )
        );

        raise exception 'Demasiadas correcciones por scanner. Revisá el stock o esperá unos minutos.';
    end if;

    v_nuevo := v_anterior + 1;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_stock.id;

    update public.scanner_stock_rate_limit
       set correcciones = correcciones + 1,
           actualizado = now()
     where negocio_id = v_negocio_id
       and sucursal_id = p_sucursal_id
       and user_id = auth.uid()
    returning correcciones into v_count;

    insert into public.movimientos(
        user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
        tipo,delta,stock_resultante,motivo,detalle
    )
    values(
        auth.uid(),
        v_negocio_id,
        p_sucursal_id,
        v_producto.id,
        v_producto.nombre,
        'ajuste',
        1,
        v_nuevo,
        'Corrección automática por escaneo físico',
        jsonb_build_object(
            'origen','scanner_venta',
            'stock_anterior',v_anterior,
            'stock_nuevo',v_nuevo,
            'correcciones_ventana',v_count
        )
    );

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'scanner_stock_correction',
        'productos',
        p_producto_id,
        jsonb_build_object(
            'sucursal_id',p_sucursal_id,
            'stock_anterior',v_anterior,
            'stock_nuevo',v_nuevo,
            'correcciones_5m',v_count
        )
    );

    return jsonb_build_object(
        'ok',true,
        'stock',v_nuevo,
        'ajustado',true
    );
end;
$$;

revoke all
on function public.confirmar_stock_por_scanner_v2(uuid,uuid,integer)
from public;

grant execute
on function public.confirmar_stock_por_scanner_v2(uuid,uuid,integer)
to authenticated;

-- Retirar ejecución de la versión menos estricta SOLO si existe.
-- Algunas instalaciones nunca llegaron a crear la v1.
do $$
begin
    if to_regprocedure(
        'public.confirmar_stock_por_scanner_v1(uuid,uuid,integer)'
    ) is not null then
        execute
            'revoke all on function public.confirmar_stock_por_scanner_v1(uuid,uuid,integer) from anon, authenticated';
    end if;
end
$$;

-- ============================================================
-- F. RLS: RECONSTRUIR POLÍTICAS DE TABLAS CRÍTICAS
-- ============================================================

-- Drop de todas las políticas antiguas de estas tablas.
do $$
declare
    v_table text;
    v_policy record;
begin
    foreach v_table in array array[
        'productos',
        'categorias',
        'producto_stock_sucursal',
        'ventas',
        'venta_items',
        'venta_pagos',
        'venta_devoluciones',
        'venta_devolucion_items',
        'movimientos',
        'proveedores',
        'compras',
        'compra_items',
        'producto_costos_historial',
        'inventario_conteos',
        'inventario_conteo_items',
        'audit_log'
    ]
    loop
        if to_regclass('public.' || v_table) is not null then
            execute format(
                'alter table public.%I enable row level security',
                v_table
            );

            for v_policy in
                select policyname
                  from pg_policies
                 where schemaname = 'public'
                   and tablename = v_table
            loop
                execute format(
                    'drop policy if exists %I on public.%I',
                    v_policy.policyname,
                    v_table
                );
            end loop;
        end if;
    end loop;
end
$$;

-- Políticas creadas de forma condicional para tolerar instalaciones
-- históricas donde alguna tabla opcional todavía no exista.
do $policy$
begin
    if to_regclass('public.productos') is not null then
        execute $sql$
            create policy security_productos_select
            on public.productos
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.categorias') is not null then
        execute $sql$
            create policy security_categorias_select
            on public.categorias
            for select
            to authenticated
            using (negocio_id is not null and public.es_miembro_negocio(negocio_id))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.producto_stock_sucursal') is not null then
        execute $sql$
            create policy security_stock_select
            on public.producto_stock_sucursal
            for select
            to authenticated
            using (public.es_miembro_negocio(negocio_id))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.ventas') is not null then
        execute $sql$
            create policy security_ventas_select
            on public.ventas
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.venta_items') is not null then
        execute $sql$
            create policy security_venta_items_select
            on public.venta_items
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.venta_pagos') is not null then
        execute $sql$
            create policy security_venta_pagos_select
            on public.venta_pagos
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.venta_devoluciones') is not null then
        execute $sql$
            create policy security_venta_devoluciones_select
            on public.venta_devoluciones
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.venta_devolucion_items') is not null then
        execute $sql$
            create policy security_venta_devolucion_items_select
            on public.venta_devolucion_items
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.movimientos') is not null then
        execute $sql$
            create policy security_movimientos_select
            on public.movimientos
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.proveedores') is not null then
        execute $sql$
            create policy security_proveedores_select
            on public.proveedores
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.compras') is not null then
        execute $sql$
            create policy security_compras_select
            on public.compras
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.compra_items') is not null then
        execute $sql$
            create policy security_compra_items_select
            on public.compra_items
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.producto_costos_historial') is not null then
        execute $sql$
            create policy security_costos_select
            on public.producto_costos_historial
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.inventario_conteos') is not null then
        execute $sql$
            create policy security_conteos_select
            on public.inventario_conteos
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.inventario_conteo_items') is not null then
        execute $sql$
            create policy security_conteo_items_select
            on public.inventario_conteo_items
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
        $sql$;
    end if;
end
$policy$;

do $policy$
begin
    if to_regclass('public.audit_log') is not null then
        execute $sql$
            create policy security_audit_select
            on public.audit_log
            for select
            to authenticated
            using (public.tiene_rol_negocio(negocio_id, array['owner','admin']))
        $sql$;
    end if;
end
$policy$;

-- ============================================================
-- G. GRANTS: SIN ESCRITURAS DIRECTAS EN TABLAS CRÍTICAS
-- ============================================================

do $$
declare
    v_table text;
begin
    foreach v_table in array array[
        'productos',
        'categorias',
        'producto_stock_sucursal',
        'ventas',
        'venta_items',
        'venta_pagos',
        'venta_devoluciones',
        'venta_devolucion_items',
        'movimientos',
        'proveedores',
        'compras',
        'compra_items',
        'producto_costos_historial',
        'inventario_conteos',
        'inventario_conteo_items',
        'audit_log',
        'descuento_autorizaciones',
        'descuento_pin_intentos',
        'scanner_stock_rate_limit'
    ]
    loop
        if to_regclass('public.' || v_table) is not null then
            execute format(
                'revoke insert, update, delete, truncate on table public.%I from anon, authenticated',
                v_table
            );
        end if;
    end loop;
end
$$;

-- Tablas internas que el navegador no necesita consultar directamente.
do $$
declare
    v_table text;
begin
    foreach v_table in array array[
        'audit_log',
        'descuento_autorizaciones',
        'descuento_pin_intentos',
        'scanner_stock_rate_limit'
    ]
    loop
        if to_regclass('public.' || v_table) is not null then
            execute format(
                'revoke select on table public.%I from anon',
                v_table
            );
        end if;
    end loop;
end
$$;

-- ============================================================
-- H. REALTIME
-- ============================================================

-- Realtime solo necesita tablas que la aplicación realmente escucha.
do $$
declare
    v_table text;
begin
    foreach v_table in array array[
        'productos',
        'producto_stock_sucursal',
        'ventas',
        'movimientos',
        'compras',
        'proveedores'
    ]
    loop
        if to_regclass('public.' || v_table) is not null
           and not exists (
               select 1
                 from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = v_table
           ) then
            execute format(
                'alter publication supabase_realtime add table public.%I',
                v_table
            );
        end if;
    end loop;
end
$$;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- ETAPA 3 — STABILITY & DATA INTEGRITY v2.30.1.1
-- ============================================================

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
