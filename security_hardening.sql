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

-- Retirar ejecución de la versión menos estricta.
revoke all
on function public.confirmar_stock_por_scanner_v1(uuid,uuid,integer)
from anon, authenticated;

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

-- Productos: lectura directa solo supervisores.
create policy security_productos_select
on public.productos
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

-- Categorías no contienen información sensible: miembros del negocio.
create policy security_categorias_select
on public.categorias
for select
to authenticated
using (
    negocio_id is not null
    and public.es_miembro_negocio(negocio_id)
);

-- Stock: todos los miembros necesitan Realtime.
create policy security_stock_select
on public.producto_stock_sucursal
for select
to authenticated
using (
    public.es_miembro_negocio(negocio_id)
);

-- Historial de ventas y costos: supervisores.
create policy security_ventas_select
on public.ventas
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_venta_items_select
on public.venta_items
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_venta_pagos_select
on public.venta_pagos
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_venta_devoluciones_select
on public.venta_devoluciones
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_venta_devolucion_items_select
on public.venta_devolucion_items
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_movimientos_select
on public.movimientos
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_proveedores_select
on public.proveedores
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_compras_select
on public.compras
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_compra_items_select
on public.compra_items
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_costos_select
on public.producto_costos_historial
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_conteos_select
on public.inventario_conteos
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_conteo_items_select
on public.inventario_conteo_items
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy security_audit_select
on public.audit_log
for select
to authenticated
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin']
    )
);

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
