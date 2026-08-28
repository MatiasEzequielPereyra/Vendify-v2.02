-- ============================================================
-- Vendify — Carga inicial de stock flexible
--
-- Objetivo:
-- - Mientras un producto/sucursal todavía está en puesta en marcha,
--   + y - ajustan 1 unidad sin pedir motivo.
-- - Esos movimientos quedan registrados como "stock_inicial".
-- - Al aparecer la primera actividad operativa real, se cierra la
--   carga inicial de ese producto/sucursal.
-- - Desde entonces + / - requieren el ajuste profesional con motivo.
-- ============================================================

begin;

-- 1) Estado persistente por producto y sucursal.
alter table public.producto_stock_sucursal
    add column if not exists stock_inicial_cerrado boolean not null default false,
    add column if not exists stock_inicial_cerrado_en timestamptz;

-- 2) Permitir el nuevo tipo de movimiento.
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
          union select 'stock_inicial'
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

-- 3) Backfill.
-- Cerramos la etapa inicial solo cuando ya hubo actividad claramente
-- operativa. Un producto que simplemente tiene stock cargado pero nunca
-- se vendió/compró/transfirió puede seguir ajustándose como carga inicial.
update public.producto_stock_sucursal ps
   set stock_inicial_cerrado = true,
       stock_inicial_cerrado_en = coalesce(ps.stock_inicial_cerrado_en, now())
 where ps.stock_inicial_cerrado = false
   and (
       exists (
           select 1
           from public.movimientos m
           where m.negocio_id = ps.negocio_id
             and m.sucursal_id = ps.sucursal_id
             and m.producto_id = ps.producto_id
             and (
                 m.tipo in (
                     'venta','ingreso','rotura','vencimiento','perdida',
                     'inventario','transferencia_salida','transferencia_entrada',
                     'devolucion','compra'
                 )
                 or (
                     m.tipo = 'ajuste'
                     and coalesce(m.detalle->>'nota','') not like 'Ajuste rápido % desde Productos'
                     and coalesce(m.motivo,'') <> 'Corrección automática por escaneo físico'
                 )
             )
       )
       or exists (
           select 1
           from public.ventas v
           join public.venta_items vi on vi.venta_id = v.id
           where v.negocio_id = ps.negocio_id
             and v.sucursal_id = ps.sucursal_id
             and vi.producto_id = ps.producto_id
             and coalesce(v.estado,'completada') <> 'anulada'
       )
   );

-- 4) Cerrar automáticamente el modo inicial ante cualquier movimiento
-- operativo futuro.
create or replace function public.cerrar_stock_inicial_por_movimiento_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.tipo <> 'stock_inicial' then
        update public.producto_stock_sucursal ps
           set stock_inicial_cerrado = true,
               stock_inicial_cerrado_en = coalesce(ps.stock_inicial_cerrado_en, now())
         where ps.negocio_id = new.negocio_id
           and ps.sucursal_id = new.sucursal_id
           and ps.producto_id = new.producto_id
           and ps.stock_inicial_cerrado = false;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_cerrar_stock_inicial_por_movimiento
on public.movimientos;

create trigger trg_cerrar_stock_inicial_por_movimiento
after insert on public.movimientos
for each row
execute function public.cerrar_stock_inicial_por_movimiento_v1();

-- Refuerzo: una venta cierra la carga inicial incluso si alguna versión
-- anterior del RPC de venta no hubiese insertado movimiento de inventario.
create or replace function public.cerrar_stock_inicial_por_venta_item_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sucursal_id uuid;
    v_negocio_id uuid;
begin
    select v.sucursal_id, v.negocio_id
      into v_sucursal_id, v_negocio_id
      from public.ventas v
     where v.id = new.venta_id;

    if v_sucursal_id is not null then
        update public.producto_stock_sucursal ps
           set stock_inicial_cerrado = true,
               stock_inicial_cerrado_en = coalesce(ps.stock_inicial_cerrado_en, now())
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = v_sucursal_id
           and ps.producto_id = new.producto_id
           and ps.stock_inicial_cerrado = false;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_cerrar_stock_inicial_por_venta_item
on public.venta_items;

create trigger trg_cerrar_stock_inicial_por_venta_item
after insert on public.venta_items
for each row
execute function public.cerrar_stock_inicial_por_venta_item_v1();

-- 5) Establecer stock inicial al crear un producto.
-- Esto reemplaza el setter normal solo para altas nuevas del frontend.
create or replace function public.establecer_stock_inicial_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_stock integer,
    p_stock_minimo integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_row public.producto_stock_sucursal;
    v_anterior integer;
    v_delta integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para cargar stock';
    end if;

    if p_stock is null or p_stock < 0 then
        raise exception 'Stock inválido';
    end if;

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_producto.id is null then
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
      into v_row
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if v_row.id is null then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo,
            stock_inicial_cerrado
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(p_stock_minimo,0),0),false
        )
        returning * into v_row;
    end if;

    if v_row.stock_inicial_cerrado then
        raise exception 'La carga inicial de este producto ya está cerrada';
    end if;

    v_anterior := v_row.stock;
    v_delta := p_stock - v_anterior;

    update public.producto_stock_sucursal
       set stock = p_stock,
           stock_minimo = greatest(coalesce(p_stock_minimo,0),0),
           actualizado = now()
     where id = v_row.id;

    if v_delta <> 0 then
        insert into public.movimientos(
            user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
            tipo,delta,stock_resultante,motivo,detalle
        )
        values(
            auth.uid(),v_negocio_id,p_sucursal_id,v_producto.id,v_producto.nombre,
            'stock_inicial',v_delta,p_stock,'Carga inicial de stock',
            jsonb_build_object(
                'stock_anterior',v_anterior,
                'stock_nuevo',p_stock,
                'origen','alta_producto'
            )
        );
    end if;

    return jsonb_build_object(
        'ok',true,
        'stock',p_stock,
        'stock_inicial',true
    );
end;
$$;

revoke all on function public.establecer_stock_inicial_v1(uuid,uuid,integer,integer) from public;
grant execute on function public.establecer_stock_inicial_v1(uuid,uuid,integer,integer) to authenticated;

-- 6) +/- inteligente.
create or replace function public.ajustar_stock_inicial_rapido_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_delta integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_row public.producto_stock_sucursal;
    v_nuevo integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para modificar stock';
    end if;

    if p_delta not in (-1,1) then
        raise exception 'El ajuste rápido solo admite una unidad por vez';
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
      into v_row
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if v_row.id is null then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo,
            stock_inicial_cerrado
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(v_producto.stock_minimo,0),0),false
        )
        returning * into v_row;
    end if;

    if v_row.stock_inicial_cerrado then
        return jsonb_build_object(
            'ok',true,
            'requiere_motivo',true,
            'stock',v_row.stock
        );
    end if;

    v_nuevo := v_row.stock + p_delta;

    if v_nuevo < 0 then
        return jsonb_build_object(
            'ok',false,
            'requiere_motivo',false,
            'stock',v_row.stock,
            'message','El stock no puede ser negativo'
        );
    end if;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_row.id;

    insert into public.movimientos(
        user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
        tipo,delta,stock_resultante,motivo,detalle
    )
    values(
        auth.uid(),v_negocio_id,p_sucursal_id,v_producto.id,v_producto.nombre,
        'stock_inicial',p_delta,v_nuevo,'Carga inicial de stock',
        jsonb_build_object(
            'origen','boton_rapido',
            'delta',p_delta
        )
    );

    return jsonb_build_object(
        'ok',true,
        'requiere_motivo',false,
        'stock',v_nuevo,
        'stock_inicial',true
    );
end;
$$;

revoke all on function public.ajustar_stock_inicial_rapido_v1(uuid,uuid,integer) from public;
grant execute on function public.ajustar_stock_inicial_rapido_v1(uuid,uuid,integer) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- Diagnóstico opcional
-- ============================================================
-- select
--   p.nombre,
--   ps.stock,
--   ps.stock_inicial_cerrado,
--   ps.stock_inicial_cerrado_en
-- from public.producto_stock_sucursal ps
-- join public.productos p on p.id = ps.producto_id
-- where ps.sucursal_id = '<ID_SUCURSAL>'
-- order by p.nombre;
