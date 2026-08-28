-- ============================================================
-- Vendify — FIX Realtime de stock entre dispositivos
--
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- No borra datos ni modifica cantidades.
-- ============================================================

begin;

-- UPDATE/DELETE completos para eventos filtrados y diagnóstico.
alter table public.producto_stock_sucursal replica identity full;
alter table public.productos replica identity full;

-- Asegurar que las dos tablas relevantes estén publicadas en
-- la publicación que usa Supabase Realtime.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'producto_stock_sucursal'
    ) then
        execute
            'alter publication supabase_realtime add table public.producto_stock_sucursal';
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'productos'
    ) then
        execute
            'alter publication supabase_realtime add table public.productos';
    end if;
end
$$;

commit;

-- VERIFICACIÓN:
select
    schemaname,
    tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('productos', 'producto_stock_sucursal')
order by tablename;

-- El resultado debe mostrar:
--
-- public | producto_stock_sucursal
-- public | productos
