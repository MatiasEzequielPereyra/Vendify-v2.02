-- ============================================================
-- Vendify — Stock inteligente por producto y sucursal
--
-- Requiere las migraciones de multisucursal y ventas profesionales.
--
-- Fórmula:
--   ritmo diario = 70% promedio últimos 7 días
--                + 30% promedio últimos 30 días
--
--   stock bajo = demanda estimada de 3 días × 1.25 de seguridad
--
-- Los productos sin ventas en 30 días no se marcan como stock bajo.
-- Los productos con stock 0 se informan por separado como "Sin stock".
-- ============================================================

begin;

drop function if exists public.obtener_stock_inteligente_sucursal(uuid);

create function public.obtener_stock_inteligente_sucursal(
    p_sucursal_id uuid
)
returns table (
    producto_id uuid,
    stock integer,
    vendidos_7d bigint,
    vendidos_30d bigint,
    promedio_diario numeric,
    stock_bajo_calculado integer,
    dias_cobertura numeric,
    reposicion_sugerida_7d integer,
    estado text,
    tiene_historial boolean
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
    with ventas_netas as (
        select
            vi.producto_id,
            coalesce(
                sum(
                    greatest(
                        vi.cantidad - coalesce(vi.cantidad_devuelta, 0),
                        0
                    )
                ) filter (
                    where v.creado >= now() - interval '7 days'
                ),
                0
            )::bigint as vendidos_7d,

            coalesce(
                sum(
                    greatest(
                        vi.cantidad - coalesce(vi.cantidad_devuelta, 0),
                        0
                    )
                ) filter (
                    where v.creado >= now() - interval '30 days'
                ),
                0
            )::bigint as vendidos_30d
        from public.venta_items vi
        join public.ventas v
          on v.id = vi.venta_id
         and v.negocio_id = v_negocio_id
         and v.sucursal_id = p_sucursal_id
         and v.estado <> 'anulada'
         and v.creado >= now() - interval '30 days'
        where vi.negocio_id = v_negocio_id
        group by vi.producto_id
    ),
    base as (
        select
            p.id as producto_id,
            coalesce(ps.stock, 0)::integer as stock,
            coalesce(vn.vendidos_7d, 0)::bigint as vendidos_7d,
            coalesce(vn.vendidos_30d, 0)::bigint as vendidos_30d,

            case
                when coalesce(vn.vendidos_30d, 0) <= 0 then 0::numeric

                when coalesce(vn.vendidos_7d, 0) <= 0 then
                    round(
                        (vn.vendidos_30d::numeric / 30.0),
                        4
                    )

                else
                    round(
                        (
                            0.70 * (vn.vendidos_7d::numeric / 7.0)
                            +
                            0.30 * (vn.vendidos_30d::numeric / 30.0)
                        ),
                        4
                    )
            end as promedio_diario
        from public.productos p
        join public.producto_stock_sucursal ps
          on ps.producto_id = p.id
         and ps.sucursal_id = p_sucursal_id
         and ps.negocio_id = v_negocio_id
        left join ventas_netas vn
          on vn.producto_id = p.id
        where p.negocio_id = v_negocio_id
    ),
    calculado as (
        select
            b.*,

            case
                when b.promedio_diario <= 0 then 0
                else greatest(
                    1,
                    ceil(
                        b.promedio_diario
                        * 3.0
                        * 1.25
                    )::integer
                )
            end as stock_bajo_calculado,

            case
                when b.promedio_diario <= 0 then null
                else round(
                    b.stock::numeric / b.promedio_diario,
                    1
                )
            end as dias_cobertura,

            case
                when b.promedio_diario <= 0 then 0
                else greatest(
                    0,
                    ceil(
                        b.promedio_diario
                        * 7.0
                        * 1.25
                    )::integer
                    - b.stock
                )
            end as reposicion_sugerida_7d
        from base b
    )
    select
        c.producto_id,
        c.stock,
        c.vendidos_7d,
        c.vendidos_30d,
        round(c.promedio_diario, 2),
        c.stock_bajo_calculado,
        c.dias_cobertura,
        c.reposicion_sugerida_7d,

        case
            when c.stock <= 0 then 'sin_stock'
            when c.promedio_diario <= 0 then 'sin_datos'
            when c.stock <= c.stock_bajo_calculado then 'bajo'
            when c.dias_cobertura is not null
                 and c.dias_cobertura <= 5 then 'proximo'
            else 'ok'
        end::text as estado,

        (c.vendidos_30d > 0) as tiene_historial

    from calculado c
    order by c.producto_id;
end;
$$;

revoke all
on function public.obtener_stock_inteligente_sucursal(uuid)
from public;

grant execute
on function public.obtener_stock_inteligente_sucursal(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- Ejemplo conceptual:
--
-- Producto A:
--   70 vendidos últimos 7 días  -> 10/día
--   300 vendidos últimos 30 días -> 10/día
--   promedio ponderado            -> 10/día
--   stock bajo = ceil(10 * 3 * 1.25) = 38
--
-- Producto B:
--   2 vendidos últimos 30 días
--   stock bajo calculado = 1
-- ============================================================
