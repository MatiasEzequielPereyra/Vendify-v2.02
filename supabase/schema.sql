-- =========================================================
-- Stock Kiosco — Esquema Supabase (Fase 2: multi-dispositivo)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- =========================================================

-- Extensión para generar UUIDs
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- Tabla: categorias
-- ---------------------------------------------------------
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  creado timestamptz not null default now(),
  unique (user_id, nombre)
);

-- ---------------------------------------------------------
-- Tabla: productos
-- ---------------------------------------------------------
create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  categoria text,
  precio_compra numeric not null default 0,
  precio_venta numeric not null default 0,
  stock integer not null default 0,
  stock_minimo integer not null default 5,
  foto text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create index if not exists productos_user_id_idx on productos(user_id);

-- ---------------------------------------------------------
-- Tabla: movimientos (historial de ventas / ajustes)
-- ---------------------------------------------------------
create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  producto_nombre text not null,
  tipo text not null check (tipo in ('venta', 'ajuste', 'ingreso')),
  delta integer not null,
  stock_resultante integer not null,
  creado timestamptz not null default now()
);

create index if not exists movimientos_user_id_idx on movimientos(user_id);
create index if not exists movimientos_producto_id_idx on movimientos(producto_id);

-- ---------------------------------------------------------
-- Row Level Security: cada usuario ve/edita solo lo suyo
-- ---------------------------------------------------------
alter table categorias enable row level security;
alter table productos enable row level security;
alter table movimientos enable row level security;

drop policy if exists "categorias_por_dueno" on categorias;
create policy "categorias_por_dueno" on categorias
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "productos_por_dueno" on productos;
create policy "productos_por_dueno" on productos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "movimientos_por_dueno" on movimientos;
create policy "movimientos_por_dueno" on movimientos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Función atómica: vender / ajustar stock
-- Evita que dos dispositivos vendiendo al mismo tiempo
-- pisen el stock del otro (race condition).
-- ---------------------------------------------------------
create or replace function ajustar_stock(
  p_producto_id uuid,
  p_delta integer,
  p_tipo text default 'venta'
)
returns productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto productos;
begin
  update productos
     set stock = greatest(0, stock + p_delta),
         actualizado = now()
   where id = p_producto_id
     and user_id = auth.uid()
   returning * into v_producto;

  if not found then
    raise exception 'Producto no encontrado o no autorizado';
  end if;

  insert into movimientos (user_id, producto_id, producto_nombre, tipo, delta, stock_resultante)
  values (auth.uid(), v_producto.id, v_producto.nombre, p_tipo, p_delta, v_producto.stock);

  return v_producto;
end;
$$;

-- ---------------------------------------------------------
-- Habilitar Realtime (para que los cambios se vean "en vivo"
-- en todos los dispositivos conectados)
-- ---------------------------------------------------------
alter publication supabase_realtime add table productos;
alter publication supabase_realtime add table movimientos;

-- =========================================================
-- Fin del script.
-- Después de correr esto: Authentication → Providers →
-- confirmá que "Email" esté habilitado (Magic Link).
-- =========================================================
