-- ============================================================
-- VENDIFY v2.31.0 — PREFLIGHT
-- Ejecutar ANTES de 02_v231_commercial_foundation.sql
--
-- Si termina con "PREFLIGHT OK", las dependencias principales existen.
-- Si falta algo, NO ejecutar todavía la migración v2.31.
-- ============================================================

do $$
declare
    v_missing text[] := array[]::text[];
begin
    -- Tablas base / módulos previos.
    if to_regclass('public.negocios') is null then
        v_missing := array_append(v_missing,'tabla public.negocios');
    end if;

    if to_regclass('public.negocio_miembros') is null then
        v_missing := array_append(v_missing,'tabla public.negocio_miembros');
    end if;

    if to_regclass('public.sucursales') is null then
        v_missing := array_append(v_missing,'tabla public.sucursales');
    end if;

    if to_regclass('public.cajas') is null then
        v_missing := array_append(v_missing,'tabla public.cajas');
    end if;

    if to_regclass('public.cajas_sesiones') is null then
        v_missing := array_append(v_missing,'tabla public.cajas_sesiones (v2.27)');
    end if;

    if to_regclass('public.productos') is null then
        v_missing := array_append(v_missing,'tabla public.productos');
    end if;

    if to_regclass('public.producto_stock_sucursal') is null then
        v_missing := array_append(v_missing,'tabla public.producto_stock_sucursal (v2.26)');
    end if;

    if to_regclass('public.movimientos') is null then
        v_missing := array_append(v_missing,'tabla public.movimientos');
    end if;

    if to_regclass('public.ventas') is null then
        v_missing := array_append(v_missing,'tabla public.ventas');
    end if;

    if to_regclass('public.venta_items') is null then
        v_missing := array_append(v_missing,'tabla public.venta_items');
    end if;

    if to_regclass('public.venta_pagos') is null then
        v_missing := array_append(v_missing,'tabla public.venta_pagos (v2.28)');
    end if;

    if to_regclass('public.proveedores') is null then
        v_missing := array_append(v_missing,'tabla public.proveedores (v2.30)');
    end if;

    if to_regclass('public.compras') is null then
        v_missing := array_append(v_missing,'tabla public.compras (v2.30)');
    end if;

    if to_regclass('public.compra_items') is null then
        v_missing := array_append(v_missing,'tabla public.compra_items (v2.30)');
    end if;

    if to_regclass('public.audit_log') is null then
        v_missing := array_append(v_missing,'tabla public.audit_log');
    end if;

    -- Helpers de seguridad / contexto.
    if to_regprocedure('public.negocio_actual_id()') is null then
        v_missing := array_append(v_missing,'función public.negocio_actual_id()');
    end if;

    if to_regprocedure('public.es_miembro_negocio(uuid)') is null then
        v_missing := array_append(v_missing,'función public.es_miembro_negocio(uuid)');
    end if;

    if to_regprocedure('public.tiene_rol_negocio(uuid,text[])') is null then
        v_missing := array_append(v_missing,'función public.tiene_rol_negocio(uuid,text[])');
    end if;

    if to_regprocedure('public.obtener_stock_inteligente_sucursal(uuid)') is null then
        v_missing := array_append(v_missing,'función obtener_stock_inteligente_sucursal(uuid)');
    end if;

    if to_regprocedure('public.establecer_stock_inicial_v1(uuid,uuid,integer,integer)') is null then
        v_missing := array_append(v_missing,'función establecer_stock_inicial_v1(...)');
    end if;

    -- Permisos stock de v2.30.1.4.
    if to_regprocedure('public.puede_modificar_stock_manual_v1(uuid)') is null then
        v_missing := array_append(v_missing,'v2.30.1.4 permisos stock: puede_modificar_stock_manual_v1(uuid)');
    end if;

    if to_regprocedure('public.obtener_permisos_personalizados_v1()') is null then
        v_missing := array_append(v_missing,'v2.30.1.4 permisos stock: obtener_permisos_personalizados_v1()');
    end if;

    if cardinality(v_missing) > 0 then
        raise exception E'PREFLIGHT FALLÓ.\nFaltan:\n- %',
            array_to_string(v_missing,E'\n- ');
    end if;

    raise notice 'PREFLIGHT OK — Vendify puede avanzar a v2.31.0';
end
$$;

-- Resumen visible.
select
    'negocios' as modulo,
    count(*) as registros
from public.negocios

union all

select
    'productos',
    count(*)
from public.productos

union all

select
    'ventas',
    count(*)
from public.ventas

union all

select
    'proveedores',
    count(*)
from public.proveedores

union all

select
    'compras',
    count(*)
from public.compras;
