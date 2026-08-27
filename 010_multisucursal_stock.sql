-- ============================================================
-- Vendify v2.26 — Multisucursal real
-- Ejecutar DESPUÉS de 009.
--
-- Objetivos:
-- - stock independiente por sucursal
-- - selector de sucursal
-- - cajas por sucursal
-- - transferencias de stock
-- - ventas descuentan stock de la sucursal activa
-- - productos.stock se mantiene como TOTAL del negocio por
--   compatibilidad con funciones anteriores.
-- ============================================================

begin;

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. STOCK POR SUCURSAL
-- ============================================================

create table if not exists public.producto_stock_sucursal (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete cascade,
    stock integer not null default 0 check (stock >= 0),
    stock_minimo integer not null default 5 check (stock_minimo >= 0),
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (sucursal_id, producto_id)
);

create index if not exists producto_stock_sucursal_negocio_idx
    on public.producto_stock_sucursal(negocio_id);

create index if not exists producto_stock_sucursal_sucursal_idx
    on public.producto_stock_sucursal(sucursal_id);

create index if not exists producto_stock_sucursal_producto_idx
    on public.producto_stock_sucursal(producto_id);

alter table public.producto_stock_sucursal enable row level security;

drop policy if exists "stock_sucursal_select_miembros"
    on public.producto_stock_sucursal;

create policy "stock_sucursal_select_miembros"
on public.producto_stock_sucursal
for select
using (
    public.es_miembro_negocio(negocio_id)
);

-- Las escrituras normales se realizan con RPCs SECURITY DEFINER.
-- No habilitamos INSERT/UPDATE/DELETE directo desde el navegador.

-- ============================================================
-- 2. SUCURSAL EN MOVIMIENTOS
-- ============================================================

alter table public.movimientos
    add column if not exists sucursal_id uuid
        references public.sucursales(id) on delete restrict;

create index if not exists movimientos_sucursal_idx
    on public.movimientos(sucursal_id);

-- ============================================================
-- 3. BACKFILL
--
-- El stock existente se coloca SOLO en la sucursal Principal
-- (o la primera sucursal activa si no existe "Principal").
-- El resto comienza en 0 para NO duplicar stock.
-- ============================================================

insert into public.producto_stock_sucursal(
    negocio_id,
    sucursal_id,
    producto_id,
    stock,
    stock_minimo
)
select
    p.negocio_id,
    s.id,
    p.id,
    case
      when s.id = principal.id then greatest(coalesce(p.stock,0),0)
      else 0
    end,
    greatest(coalesce(p.stock_minimo,5),0)
from public.productos p
join lateral (
    select sx.id
    from public.sucursales sx
    where sx.negocio_id = p.negocio_id
    order by
      case when lower(sx.nombre) = 'principal' then 0 else 1 end,
      sx.creado
    limit 1
) principal on true
join public.sucursales s
  on s.negocio_id = p.negocio_id
on conflict (sucursal_id, producto_id) do nothing;

-- ============================================================
-- 4. productos.stock = TOTAL DEL NEGOCIO
-- ============================================================

create or replace function public.recalcular_stock_total_producto_v1(
    p_producto_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total integer;
begin
    select coalesce(sum(ps.stock),0)::integer
      into v_total
      from public.producto_stock_sucursal ps
     where ps.producto_id = p_producto_id;

    update public.productos
       set stock = greatest(v_total,0),
           actualizado = now()
     where id = p_producto_id;
end;
$$;

revoke all on function public.recalcular_stock_total_producto_v1(uuid) from public;

create or replace function public.stock_sucursal_recalcular_total_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.recalcular_stock_total_producto_v1(
        coalesce(new.producto_id, old.producto_id)
    );
    return coalesce(new, old);
end;
$$;

drop trigger if exists stock_sucursal_recalcular_total_v1
    on public.producto_stock_sucursal;

create trigger stock_sucursal_recalcular_total_v1
after insert or update of stock or delete
on public.producto_stock_sucursal
for each row
execute function public.stock_sucursal_recalcular_total_trigger_v1();

-- Normalizar totales actuales.
do $$
declare
    v_id uuid;
begin
    for v_id in select id from public.productos loop
        perform public.recalcular_stock_total_producto_v1(v_id);
    end loop;
end $$;

-- ============================================================
-- 5. NUEVO PRODUCTO => FILA DE STOCK EN TODAS LAS SUCURSALES
--
-- Compatibilidad:
-- si un cliente viejo inserta stock > 0, se coloca en Principal.
-- El frontend v2.26 inserta stock=0 y luego establece la cantidad
-- de la sucursal activa mediante RPC.
-- ============================================================

create or replace function public.crear_stock_sucursales_producto_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_principal_id uuid;
begin
    select s.id
      into v_principal_id
      from public.sucursales s
     where s.negocio_id = new.negocio_id
       and s.activa = true
     order by
       case when lower(s.nombre) = 'principal' then 0 else 1 end,
       s.creado
     limit 1;

    insert into public.producto_stock_sucursal(
        negocio_id,
        sucursal_id,
        producto_id,
        stock,
        stock_minimo
    )
    select
        new.negocio_id,
        s.id,
        new.id,
        case
          when s.id = v_principal_id then greatest(coalesce(new.stock,0),0)
          else 0
        end,
        greatest(coalesce(new.stock_minimo,5),0)
    from public.sucursales s
    where s.negocio_id = new.negocio_id
    on conflict (sucursal_id, producto_id) do nothing;

    return new;
end;
$$;

drop trigger if exists productos_crear_stock_sucursales_v1
    on public.productos;

create trigger productos_crear_stock_sucursales_v1
after insert on public.productos
for each row
execute function public.crear_stock_sucursales_producto_v1();

-- ============================================================
-- 6. NUEVA SUCURSAL => STOCK 0 PARA TODOS LOS PRODUCTOS
-- ============================================================

create or replace function public.crear_stock_productos_nueva_sucursal_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.producto_stock_sucursal(
        negocio_id,
        sucursal_id,
        producto_id,
        stock,
        stock_minimo
    )
    select
        new.negocio_id,
        new.id,
        p.id,
        0,
        greatest(coalesce(p.stock_minimo,5),0)
    from public.productos p
    where p.negocio_id = new.negocio_id
    on conflict (sucursal_id, producto_id) do nothing;

    return new;
end;
$$;

drop trigger if exists sucursales_crear_stock_productos_v1
    on public.sucursales;

create trigger sucursales_crear_stock_productos_v1
after insert on public.sucursales
for each row
execute function public.crear_stock_productos_nueva_sucursal_v1();

-- ============================================================
-- 7. PRODUCTOS DE UNA SUCURSAL
-- Devuelve nombres de columnas compatibles con el frontend.
-- ============================================================

create or replace function public.listar_productos_sucursal_v1(
    p_sucursal_id uuid
)
returns table (
    id uuid,
    user_id uuid,
    negocio_id uuid,
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
    creado timestamptz,
    actualizado timestamptz
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

    if not exists (
        select 1
        from public.sucursales s
        where s.id = p_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inexistente o inactiva';
    end if;

    return query
    select
        p.id,
        p.user_id,
        p.negocio_id,
        p.nombre,
        coalesce(p.marca,'')::text,
        coalesce(p.presentacion,'')::text,
        p.codigo_barras,
        coalesce(p.categoria,'')::text,
        p.precio_compra,
        p.precio_venta,
        coalesce(ps.stock,0)::integer,
        coalesce(ps.stock_minimo,p.stock_minimo,5)::integer,
        p.foto,
        p.creado,
        p.actualizado
    from public.productos p
    left join public.producto_stock_sucursal ps
      on ps.producto_id = p.id
     and ps.sucursal_id = p_sucursal_id
    where p.negocio_id = v_negocio_id
    order by p.nombre;
end;
$$;

revoke all on function public.listar_productos_sucursal_v1(uuid) from public;
grant execute on function public.listar_productos_sucursal_v1(uuid) to authenticated;

-- ============================================================
-- 8. ESTABLECER STOCK ABSOLUTO DE UNA SUCURSAL
-- Usado al crear/editar productos.
-- ============================================================

create or replace function public.establecer_stock_sucursal_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_stock integer,
    p_stock_minimo integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_anterior integer;
    v_resultado public.producto_stock_sucursal;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_stock < 0 or p_stock_minimo < 0 then
        raise exception 'Stock inválido';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para modificar stock';
    end if;

    select p.nombre
      into v_nombre
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_nombre is null then
        raise exception 'Producto no encontrado';
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

    insert into public.producto_stock_sucursal(
        negocio_id,
        sucursal_id,
        producto_id,
        stock,
        stock_minimo
    )
    values(
        v_negocio_id,
        p_sucursal_id,
        p_producto_id,
        p_stock,
        p_stock_minimo
    )
    on conflict (sucursal_id, producto_id)
    do update set
        stock = excluded.stock,
        stock_minimo = excluded.stock_minimo,
        actualizado = now()
    returning * into v_resultado;

    -- El movimiento solo se registra si podemos conocer el anterior.
    -- Si la fila ya existía lo obtenemos desde audit de diferencia vía total,
    -- pero para evitar ruido en altas dejamos un movimiento de ajuste con
    -- stock_resultante exacto.
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
        p_sucursal_id,
        p_producto_id,
        v_nombre,
        'ajuste',
        0,
        p_stock
    );

    return jsonb_build_object(
        'stock', v_resultado.stock,
        'stock_minimo', v_resultado.stock_minimo
    );
end;
$$;

revoke all on function public.establecer_stock_sucursal_v1(uuid,uuid,integer,integer) from public;
grant execute on function public.establecer_stock_sucursal_v1(uuid,uuid,integer,integer) to authenticated;

-- ============================================================
-- 9. AJUSTE INCREMENTAL DE STOCK POR SUCURSAL
-- ============================================================

create or replace function public.ajustar_stock_sucursal_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_delta integer,
    p_tipo text default 'ajuste'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_stock public.producto_stock_sucursal;
    v_producto public.productos;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para ajustar stock';
    end if;

    select *
      into v_producto
      from public.productos
     where id = p_producto_id
       and negocio_id = v_negocio_id;

    if not found then
        raise exception 'Producto no encontrado';
    end if;

    select *
      into v_stock
      from public.producto_stock_sucursal
     where producto_id = p_producto_id
       and sucursal_id = p_sucursal_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(v_producto.stock_minimo,5),0)
        )
        returning * into v_stock;
    end if;

    if v_stock.stock + p_delta < 0 then
        raise exception 'Stock insuficiente. Stock actual: %', v_stock.stock;
    end if;

    update public.producto_stock_sucursal
       set stock = stock + p_delta,
           actualizado = now()
     where id = v_stock.id
     returning * into v_stock;

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
        p_sucursal_id,
        v_producto.id,
        v_producto.nombre,
        p_tipo,
        p_delta,
        v_stock.stock
    );

    return jsonb_build_object(
        'stock', v_stock.stock,
        'stock_minimo', v_stock.stock_minimo
    );
end;
$$;

revoke all on function public.ajustar_stock_sucursal_v1(uuid,uuid,integer,text) from public;
grant execute on function public.ajustar_stock_sucursal_v1(uuid,uuid,integer,text) to authenticated;

-- ============================================================
-- 10. VENTA V2 — ahora descuenta stock DE LA SUCURSAL
-- Mantiene la misma firma para no romper el frontend.
-- ============================================================

create or replace function public.registrar_venta_v2(
    p_items jsonb,
    p_medio_pago text default null,
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
    v_total numeric := 0;
    v_venta public.ventas;
    v_item record;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'El carrito está vacío';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager','cashier']
    ) then
        raise exception 'No tenés permiso para registrar ventas';
    end if;

    if p_sucursal_id is null then
        select s.id
          into v_sucursal_id
          from public.sucursales s
         where s.negocio_id = v_negocio_id
           and s.activa = true
         order by
           case when lower(s.nombre) = 'principal' then 0 else 1 end,
           s.creado
         limit 1;
    else
        select s.id
          into v_sucursal_id
          from public.sucursales s
         where s.id = p_sucursal_id
           and s.negocio_id = v_negocio_id
           and s.activa = true;
    end if;

    if v_sucursal_id is null then
        raise exception 'Sucursal inválida';
    end if;

    if p_caja_id is null then
        select c.id
          into v_caja_id
          from public.cajas c
         where c.negocio_id = v_negocio_id
           and c.sucursal_id = v_sucursal_id
           and c.activa = true
         order by c.creado
         limit 1;
    else
        select c.id
          into v_caja_id
          from public.cajas c
         where c.id = p_caja_id
           and c.negocio_id = v_negocio_id
           and c.sucursal_id = v_sucursal_id
           and c.activa = true;
    end if;

    if v_caja_id is null then
        raise exception 'Caja inválida';
    end if;

    -- Locks y validación de stock por sucursal.
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
            raise exception 'El producto "%" no tiene stock configurado en esta sucursal',
                v_producto.nombre;
        end if;

        if v_stock.stock < v_item.cantidad then
            raise exception 'Stock insuficiente de "%": quedan % unidades en esta sucursal',
                v_producto.nombre,
                v_stock.stock;
        end if;
    end loop;

    insert into public.ventas(
        user_id,
        negocio_id,
        sucursal_id,
        caja_id,
        total,
        medio_pago
    )
    values(
        auth.uid(),
        v_negocio_id,
        v_sucursal_id,
        v_caja_id,
        0,
        p_medio_pago
    )
    returning * into v_venta;

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
         where producto_id = v_item.producto_id
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
            costo_unitario,
            subtotal
        )
        values(
            v_venta.id,
            auth.uid(),
            v_negocio_id,
            v_producto.id,
            v_producto.nombre,
            v_item.cantidad,
            v_producto.precio_venta,
            v_producto.precio_compra,
            v_producto.precio_venta * v_item.cantidad
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

        v_total := v_total + (v_producto.precio_venta * v_item.cantidad);
    end loop;

    update public.ventas
       set total = v_total
     where id = v_venta.id
     returning * into v_venta;

    return jsonb_build_object(
        'venta', to_jsonb(v_venta),
        'negocio_id', v_negocio_id,
        'sucursal_id', v_sucursal_id,
        'caja_id', v_caja_id
    );
end;
$$;

revoke all on function public.registrar_venta_v2(jsonb,text,uuid,uuid) from public;
grant execute on function public.registrar_venta_v2(jsonb,text,uuid,uuid) to authenticated;

-- ============================================================
-- 11. ADMINISTRACIÓN DE SUCURSALES
-- ============================================================

create or replace function public.listar_sucursales_admin_v1()
returns table (
    id uuid,
    nombre text,
    direccion text,
    telefono text,
    activa boolean,
    stock_total bigint,
    cajas jsonb
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
        raise exception 'No tenés permiso para consultar sucursales';
    end if;

    return query
    select
        s.id,
        s.nombre,
        s.direccion,
        s.telefono,
        s.activa,
        coalesce(sum(ps.stock),0)::bigint,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'id', c.id,
                        'nombre', c.nombre,
                        'activa', c.activa
                    )
                    order by c.creado
                )
                from public.cajas c
                where c.sucursal_id = s.id
                  and c.negocio_id = v_negocio_id
            ),
            '[]'::jsonb
        )
    from public.sucursales s
    left join public.producto_stock_sucursal ps
      on ps.sucursal_id = s.id
    where s.negocio_id = v_negocio_id
    group by s.id
    order by
      case when lower(s.nombre) = 'principal' then 0 else 1 end,
      s.nombre;
end;
$$;

revoke all on function public.listar_sucursales_admin_v1() from public;
grant execute on function public.listar_sucursales_admin_v1() to authenticated;

create or replace function public.crear_sucursal_v1(
    p_nombre text,
    p_direccion text default null,
    p_telefono text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal public.sucursales;
    v_caja public.cajas;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para crear sucursales';
    end if;

    if length(trim(coalesce(p_nombre,''))) < 2 then
        raise exception 'Ingresá un nombre válido';
    end if;

    if exists (
        select 1
        from public.sucursales s
        where s.negocio_id = v_negocio_id
          and lower(s.nombre) = lower(trim(p_nombre))
    ) then
        raise exception 'Ya existe una sucursal con ese nombre';
    end if;

    insert into public.sucursales(
        negocio_id,nombre,direccion,telefono,activa
    )
    values(
        v_negocio_id,
        trim(p_nombre),
        nullif(trim(coalesce(p_direccion,'')),''),
        nullif(trim(coalesce(p_telefono,'')),''),
        true
    )
    returning * into v_sucursal;

    insert into public.cajas(
        negocio_id,sucursal_id,nombre,activa
    )
    values(
        v_negocio_id,v_sucursal.id,'Caja 1',true
    )
    returning * into v_caja;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,auth.uid(),'sucursal_creada','sucursales',
        v_sucursal.id,
        jsonb_build_object('nombre',v_sucursal.nombre)
    );

    return jsonb_build_object(
        'sucursal', to_jsonb(v_sucursal),
        'caja', to_jsonb(v_caja)
    );
end;
$$;

revoke all on function public.crear_sucursal_v1(text,text,text) from public;
grant execute on function public.crear_sucursal_v1(text,text,text) to authenticated;

create or replace function public.actualizar_sucursal_v1(
    p_sucursal_id uuid,
    p_nombre text,
    p_direccion text default null,
    p_telefono text default null,
    p_activa boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_actual public.sucursales;
    v_resultado public.sucursales;
    v_activas integer;
    v_stock bigint;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para editar sucursales';
    end if;

    select *
      into v_actual
      from public.sucursales
     where id = p_sucursal_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Sucursal inexistente';
    end if;

    if length(trim(coalesce(p_nombre,''))) < 2 then
        raise exception 'Ingresá un nombre válido';
    end if;

    if exists (
        select 1
        from public.sucursales s
        where s.negocio_id = v_negocio_id
          and s.id <> p_sucursal_id
          and lower(s.nombre) = lower(trim(p_nombre))
    ) then
        raise exception 'Ya existe una sucursal con ese nombre';
    end if;

    if v_actual.activa = true and p_activa = false then
        select count(*)
          into v_activas
          from public.sucursales s
         where s.negocio_id = v_negocio_id
           and s.activa = true;

        if v_activas <= 1 then
            raise exception 'No podés desactivar la única sucursal activa';
        end if;

        select coalesce(sum(ps.stock),0)
          into v_stock
          from public.producto_stock_sucursal ps
         where ps.sucursal_id = p_sucursal_id;

        if v_stock > 0 then
            raise exception 'Transferí o ajustá el stock antes de desactivar la sucursal';
        end if;
    end if;

    update public.sucursales
       set nombre = trim(p_nombre),
           direccion = nullif(trim(coalesce(p_direccion,'')),''),
           telefono = nullif(trim(coalesce(p_telefono,'')),''),
           activa = p_activa,
           actualizado = now()
     where id = p_sucursal_id
     returning * into v_resultado;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,auth.uid(),'sucursal_actualizada','sucursales',
        v_resultado.id,
        jsonb_build_object(
            'nombre',v_resultado.nombre,
            'activa',v_resultado.activa
        )
    );

    return to_jsonb(v_resultado);
end;
$$;

revoke all on function public.actualizar_sucursal_v1(uuid,text,text,text,boolean) from public;
grant execute on function public.actualizar_sucursal_v1(uuid,text,text,text,boolean) to authenticated;

-- ============================================================
-- 12. CAJAS
-- ============================================================

create or replace function public.crear_caja_v1(
    p_sucursal_id uuid,
    p_nombre text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_caja public.cajas;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para crear cajas';
    end if;

    if not exists (
        select 1 from public.sucursales
        where id = p_sucursal_id
          and negocio_id = v_negocio_id
    ) then
        raise exception 'Sucursal inválida';
    end if;

    if length(trim(coalesce(p_nombre,''))) < 2 then
        raise exception 'Ingresá un nombre válido para la caja';
    end if;

    if exists (
        select 1
        from public.cajas c
        where c.sucursal_id = p_sucursal_id
          and lower(c.nombre) = lower(trim(p_nombre))
    ) then
        raise exception 'Ya existe una caja con ese nombre';
    end if;

    insert into public.cajas(
        negocio_id,sucursal_id,nombre,activa
    )
    values(
        v_negocio_id,p_sucursal_id,trim(p_nombre),true
    )
    returning * into v_caja;

    return to_jsonb(v_caja);
end;
$$;

revoke all on function public.crear_caja_v1(uuid,text) from public;
grant execute on function public.crear_caja_v1(uuid,text) to authenticated;

create or replace function public.cambiar_estado_caja_v1(
    p_caja_id uuid,
    p_activa boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_caja public.cajas;
    v_activas integer;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para modificar cajas';
    end if;

    select *
      into v_caja
      from public.cajas
     where id = p_caja_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Caja inexistente';
    end if;

    if v_caja.activa = true and p_activa = false then
        select count(*)
          into v_activas
          from public.cajas c
         where c.sucursal_id = v_caja.sucursal_id
           and c.activa = true;

        if v_activas <= 1 then
            raise exception 'La sucursal debe conservar al menos una caja activa';
        end if;
    end if;

    update public.cajas
       set activa = p_activa
     where id = p_caja_id
     returning * into v_caja;

    return to_jsonb(v_caja);
end;
$$;

revoke all on function public.cambiar_estado_caja_v1(uuid,boolean) from public;
grant execute on function public.cambiar_estado_caja_v1(uuid,boolean) to authenticated;

-- ============================================================
-- 13. TRANSFERENCIA ENTRE SUCURSALES
-- ============================================================

create or replace function public.transferir_stock_v1(
    p_producto_id uuid,
    p_origen_id uuid,
    p_destino_id uuid,
    p_cantidad integer
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
begin
    if p_origen_id = p_destino_id then
        raise exception 'Origen y destino deben ser distintos';
    end if;

    if p_cantidad is null or p_cantidad <= 0 then
        raise exception 'Cantidad inválida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para transferir stock';
    end if;

    select *
      into v_producto
      from public.productos
     where id = p_producto_id
       and negocio_id = v_negocio_id;

    if not found then
        raise exception 'Producto inexistente';
    end if;

    if not exists (
        select 1
        from public.sucursales
        where id in (p_origen_id,p_destino_id)
          and negocio_id = v_negocio_id
          and activa = true
        group by negocio_id
        having count(*) = 2
    ) then
        raise exception 'Sucursal de origen o destino inválida';
    end if;

    -- Bloqueo determinístico para evitar deadlocks.
    perform 1
      from public.producto_stock_sucursal ps
     where ps.producto_id = p_producto_id
       and ps.sucursal_id in (p_origen_id,p_destino_id)
     order by ps.sucursal_id
     for update;

    select *
      into v_origen
      from public.producto_stock_sucursal
     where producto_id = p_producto_id
       and sucursal_id = p_origen_id
       and negocio_id = v_negocio_id;

    select *
      into v_destino
      from public.producto_stock_sucursal
     where producto_id = p_producto_id
       and sucursal_id = p_destino_id
       and negocio_id = v_negocio_id;

    if v_origen.id is null or v_destino.id is null then
        raise exception 'No se encontró el stock del producto en ambas sucursales';
    end if;

    if v_origen.stock < p_cantidad then
        raise exception 'Stock insuficiente en la sucursal de origen. Disponible: %',
            v_origen.stock;
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
        tipo,delta,stock_resultante
    )
    values
    (
        auth.uid(),v_negocio_id,p_origen_id,v_producto.id,v_producto.nombre,
        'transferencia_salida',-p_cantidad,v_origen.stock
    ),
    (
        auth.uid(),v_negocio_id,p_destino_id,v_producto.id,v_producto.nombre,
        'transferencia_entrada',p_cantidad,v_destino.stock
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
            'origen',p_origen_id,
            'destino',p_destino_id,
            'cantidad',p_cantidad
        )
    );

    return jsonb_build_object(
        'ok',true,
        'stock_origen',v_origen.stock,
        'stock_destino',v_destino.stock
    );
end;
$$;

revoke all on function public.transferir_stock_v1(uuid,uuid,uuid,integer) from public;
grant execute on function public.transferir_stock_v1(uuid,uuid,uuid,integer) to authenticated;

-- ============================================================
-- 14. FORECAST POR SUCURSAL (base futura para WhatsApp)
-- ============================================================

create or replace function public.obtener_alertas_stock_sucursal_v1(
    p_sucursal_id uuid
)
returns table (
    producto_id uuid,
    nombre text,
    stock integer,
    stock_minimo integer,
    vendidos_7d bigint,
    vendidos_30d bigint,
    promedio_diario numeric,
    dias_stock numeric,
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
    v_negocio_id := public.negocio_actual_id();

    if not exists (
        select 1 from public.sucursales
        where id = p_sucursal_id
          and negocio_id = v_negocio_id
    ) then
        raise exception 'Sucursal inválida';
    end if;

    return query
    with ventas_producto as (
        select
            p.id producto_id,
            coalesce(sum(vi.cantidad) filter (
                where v.creado >= now() - interval '7 days'
            ),0)::bigint vendidos_7d,
            coalesce(sum(vi.cantidad) filter (
                where v.creado >= now() - interval '30 days'
            ),0)::bigint vendidos_30d
        from public.productos p
        left join public.venta_items vi
          on vi.producto_id = p.id
         and vi.negocio_id = p.negocio_id
        left join public.ventas v
          on v.id = vi.venta_id
         and v.negocio_id = p.negocio_id
         and v.sucursal_id = p_sucursal_id
         and v.creado >= now() - interval '30 days'
        where p.negocio_id = v_negocio_id
        group by p.id
    )
    select
        p.id,
        p.nombre,
        ps.stock,
        ps.stock_minimo,
        vp.vendidos_7d,
        vp.vendidos_30d,
        round(vp.vendidos_30d::numeric / 30.0,2),
        case
          when vp.vendidos_30d > 0
          then round(
            ps.stock::numeric / (vp.vendidos_30d::numeric / 30.0),
            1
          )
          else null
        end,
        case
          when ps.stock <= 0 then 'sin_stock'
          when vp.vendidos_30d > 0
               and ps.stock::numeric / (vp.vendidos_30d::numeric / 30.0) <= 1
            then 'critico'
          when ps.stock <= ps.stock_minimo then 'bajo'
          when vp.vendidos_30d > 0
               and ps.stock::numeric / (vp.vendidos_30d::numeric / 30.0) <= 3
            then 'proximo'
          else 'ok'
        end
    from public.productos p
    join public.producto_stock_sucursal ps
      on ps.producto_id = p.id
     and ps.sucursal_id = p_sucursal_id
    join ventas_producto vp
      on vp.producto_id = p.id
    where p.negocio_id = v_negocio_id
    order by p.nombre;
end;
$$;

revoke all on function public.obtener_alertas_stock_sucursal_v1(uuid) from public;
grant execute on function public.obtener_alertas_stock_sucursal_v1(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
--
-- select s.nombre, sum(ps.stock) stock
-- from public.sucursales s
-- left join public.producto_stock_sucursal ps on ps.sucursal_id=s.id
-- group by s.id,s.nombre
-- order by s.nombre;
--
-- El stock histórico debería quedar en "Principal".
-- Las demás sucursales comienzan en 0.
-- ============================================================
