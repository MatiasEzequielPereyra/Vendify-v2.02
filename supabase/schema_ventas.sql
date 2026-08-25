-- =========================================================
-- Stock Kiosco — Migración: Sistema de ventas (POS)
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- (No borra nada de lo que ya tenías: solo agrega tablas nuevas)
-- =========================================================

-- ---------------------------------------------------------
-- Tabla: ventas (un "ticket" de venta)
-- ---------------------------------------------------------
create table if not exists ventas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  total numeric not null default 0,
  medio_pago text,
  creado timestamptz not null default now()
);

create index if not exists ventas_user_id_idx on ventas(user_id);
create index if not exists ventas_creado_idx on ventas(creado);

-- ---------------------------------------------------------
-- Tabla: venta_items (los productos dentro de cada ticket)
-- ---------------------------------------------------------
create table if not exists venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id uuid references productos(id) on delete set null,
  producto_nombre text not null,
  cantidad integer not null,
  precio_unitario numeric not null,
  subtotal numeric not null
);

create index if not exists venta_items_venta_id_idx on venta_items(venta_id);

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table ventas enable row level security;
alter table venta_items enable row level security;

drop policy if exists "ventas_por_dueno" on ventas;
create policy "ventas_por_dueno" on ventas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "venta_items_por_dueno" on venta_items;
create policy "venta_items_por_dueno" on venta_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Función: registrar_venta
-- Recibe un carrito (array de {producto_id, cantidad}) y:
--   1) valida que haya stock suficiente de TODO antes de tocar nada
--   2) descuenta el stock de cada producto
--   3) guarda el ticket (ventas) y sus líneas (venta_items)
--   4) deja registro en movimientos (historial ya existente)
-- Todo dentro de una sola transacción: si algo falla, no se
-- cobra nada y el stock queda como estaba.
-- ---------------------------------------------------------
create or replace function registrar_venta(
  p_items jsonb,
  p_medio_pago text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_producto productos;
  v_producto_id uuid;
  v_cantidad integer;
  v_total numeric := 0;
  v_venta ventas;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;

  -- 1) Validar stock de todos los productos ANTES de modificar nada
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_id := (v_item->>'producto_id')::uuid;
    v_cantidad := (v_item->>'cantidad')::integer;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida';
    end if;

    select * into v_producto from productos
      where id = v_producto_id and user_id = auth.uid()
      for update;

    if not found then
      raise exception 'Producto no encontrado';
    end if;

    if v_producto.stock < v_cantidad then
      raise exception 'Stock insuficiente de "%": quedan % unidades', v_producto.nombre, v_producto.stock;
    end if;
  end loop;

  -- 2) Crear el ticket de venta (total se completa al final)
  insert into ventas (user_id, total, medio_pago)
  values (auth.uid(), 0, p_medio_pago)
  returning * into v_venta;

  -- 3) Descontar stock, guardar líneas y movimientos
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_id := (v_item->>'producto_id')::uuid;
    v_cantidad := (v_item->>'cantidad')::integer;

    update productos
       set stock = stock - v_cantidad,
           actualizado = now()
     where id = v_producto_id
     returning * into v_producto;

    insert into venta_items (venta_id, user_id, producto_id, producto_nombre, cantidad, precio_unitario, subtotal)
    values (
      v_venta.id, auth.uid(), v_producto.id, v_producto.nombre,
      v_cantidad, v_producto.precio_venta, v_producto.precio_venta * v_cantidad
    );

    insert into movimientos (user_id, producto_id, producto_nombre, tipo, delta, stock_resultante)
    values (auth.uid(), v_producto.id, v_producto.nombre, 'venta', -v_cantidad, v_producto.stock);

    v_total := v_total + (v_producto.precio_venta * v_cantidad);
  end loop;

  update ventas set total = v_total where id = v_venta.id returning * into v_venta;

  return jsonb_build_object('venta', to_jsonb(v_venta));
end;
$$;

-- ---------------------------------------------------------
-- Realtime para el ticket de ventas (por si querés un panel
-- de "ventas de hoy" abierto en otra pantalla)
-- ---------------------------------------------------------
alter publication supabase_realtime add table ventas;

-- =========================================================
-- Fin de la migración.
-- =========================================================
