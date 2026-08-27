-- ============================================================
-- Vendify v2.9 — Código de barras + marca + presentación
-- ============================================================

begin;

alter table public.productos add column if not exists marca text;
alter table public.productos add column if not exists presentacion text;
alter table public.productos add column if not exists codigo_barras text;

update public.productos set codigo_barras = null where trim(coalesce(codigo_barras,'')) = '';

create unique index if not exists productos_codigo_barras_negocio_unique
  on public.productos(negocio_id, codigo_barras)
  where codigo_barras is not null and codigo_barras <> '';

create index if not exists productos_codigo_barras_idx
  on public.productos(codigo_barras)
  where codigo_barras is not null;

notify pgrst, 'reload schema';
commit;
