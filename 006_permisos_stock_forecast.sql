-- ============================================================
-- Vendify v2.5 — Permisos estrictos de productos + forecast stock
-- Ejecutar DESPUÉS de 005.
-- ============================================================

begin;

-- ============================================================
-- 1. PRODUCTOS: permisos explícitos por operación
-- Cajero: solo SELECT
-- Manager/Admin/Owner: INSERT / UPDATE / DELETE
-- ============================================================

alter table public.productos enable row level security;

drop policy if exists "productos_negocio_select" on public.productos;
drop policy if exists "productos_negocio_write" on public.productos;
drop policy if exists "productos_select_miembros" on public.productos;
drop policy if exists "productos_insert_gestion" on public.productos;
drop policy if exists "productos_update_gestion" on public.productos;
drop policy if exists "productos_delete_gestion" on public.productos;

create policy "productos_select_miembros"
on public.productos
for select
using (
    public.es_miembro_negocio(negocio_id)
);

create policy "productos_insert_gestion"
on public.productos
for insert
with check (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy "productos_update_gestion"
on public.productos
for update
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
)
with check (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy "productos_delete_gestion"
on public.productos
for delete
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

-- ============================================================
-- 2. CATEGORÍAS con el mismo criterio
-- ============================================================

alter table public.categorias enable row level security;

drop policy if exists "categorias_negocio_select" on public.categorias;
drop policy if exists "categorias_negocio_write" on public.categorias;
drop policy if exists "categorias_select_miembros" on public.categorias;
drop policy if exists "categorias_insert_gestion" on public.categorias;
drop policy if exists "categorias_update_gestion" on public.categorias;
drop policy if exists "categorias_delete_gestion" on public.categorias;

create policy "categorias_select_miembros"
on public.categorias
for select
using (
    public.es_miembro_negocio(negocio_id)
);

create policy "categorias_insert_gestion"
on public.categorias
for insert
with check (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy "categorias_update_gestion"
on public.categorias
for update
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
)
with check (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

create policy "categorias_delete_gestion"
on public.categorias
for delete
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

-- ============================================================
-- 3. FORECAST DE STOCK
--
-- Ventas promedio = unidades vendidas últimos 30 días / 30.
-- days_remaining = stock actual / promedio diario.
-- Si no hubo ventas, queda NULL.
-- ============================================================

create or replace function public.obtener_alertas_stock_v1()
returns table (
    producto_id uuid,
    nombre text,
    stock integer,
    stock_minimo integer,
    vendidos_7d bigint,
    vendidos_30d bigint,
    promedio_diario_30d numeric,
    dias_stock_estimados numeric,
    nivel text
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

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'No autorizado';
    end if;

    return query
    with ventas_producto as (
        select
            p.id as producto_id,
            coalesce(sum(vi.cantidad) filter (
                where v.creado >= now() - interval '7 days'
            ), 0)::bigint as vendidos_7d,
            coalesce(sum(vi.cantidad) filter (
                where v.creado >= now() - interval '30 days'
            ), 0)::bigint as vendidos_30d
        from public.productos p
        left join public.venta_items vi
          on vi.producto_id = p.id
         and vi.negocio_id = p.negocio_id
        left join public.ventas v
          on v.id = vi.venta_id
         and v.negocio_id = p.negocio_id
         and v.creado >= now() - interval '30 days'
        where p.negocio_id = v_negocio_id
        group by p.id
    ),
    calculo as (
        select
            p.id,
            p.nombre,
            p.stock,
            p.stock_minimo,
            vp.vendidos_7d,
            vp.vendidos_30d,
            round(vp.vendidos_30d::numeric / 30.0, 2) as promedio,
            case
                when vp.vendidos_30d > 0
                then round(
                    p.stock::numeric /
                    (vp.vendidos_30d::numeric / 30.0),
                    1
                )
                else null
            end as dias
        from public.productos p
        join ventas_producto vp on vp.producto_id = p.id
        where p.negocio_id = v_negocio_id
    )
    select
        c.id,
        c.nombre,
        c.stock,
        c.stock_minimo,
        c.vendidos_7d,
        c.vendidos_30d,
        c.promedio,
        c.dias,
        case
            when c.stock <= 0 then 'sin_stock'
            when c.dias is not null and c.dias <= 1 then 'critico'
            when c.stock <= c.stock_minimo then 'bajo'
            when c.dias is not null and c.dias <= 3 then 'proximo'
            else 'ok'
        end
    from calculo c
    order by
        case
            when c.stock <= 0 then 1
            when c.dias is not null and c.dias <= 1 then 2
            when c.stock <= c.stock_minimo then 3
            when c.dias is not null and c.dias <= 3 then 4
            else 5
        end,
        c.dias nulls last,
        c.nombre;
end;
$$;

revoke all on function public.obtener_alertas_stock_v1() from public;
grant execute on function public.obtener_alertas_stock_v1() to authenticated;

-- ============================================================
-- 4. Configuración futura de WhatsApp del negocio
-- No guarda tokens; solo teléfono y preferencia.
-- Tokens irán en Supabase Secrets.
-- ============================================================

alter table public.negocios
    add column if not exists whatsapp_alertas text,
    add column if not exists alertas_stock_whatsapp boolean not null default false,
    add column if not exists dias_alerta_stock numeric not null default 3;

notify pgrst, 'reload schema';

commit;
