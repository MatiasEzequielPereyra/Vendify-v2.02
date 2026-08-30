-- Vendify v2.30.1 — verificación de hardening
-- Ejecutar DESPUÉS de security_hardening.sql.

-- 1. RLS debe estar activo.
select
    c.relname as tabla,
    c.relrowsecurity as rls_activo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'productos','categorias','producto_stock_sucursal',
    'ventas','venta_items','venta_pagos','movimientos',
    'proveedores','compras','compra_items',
    'producto_costos_historial','inventario_conteos',
    'inventario_conteo_items','audit_log'
  )
order by c.relname;

-- 2. Políticas efectivas.
select
    tablename,
    policyname,
    cmd,
    roles,
    qual
from pg_policies
where schemaname = 'public'
  and tablename in (
    'productos','categorias','producto_stock_sucursal',
    'ventas','venta_items','venta_pagos','movimientos',
    'proveedores','compras','compra_items',
    'producto_costos_historial','inventario_conteos',
    'inventario_conteo_items','audit_log'
  )
order by tablename, policyname;

-- 3. Escrituras directas de authenticated deberían quedar revocadas.
select
    table_name,
    privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in (
    'productos','categorias','producto_stock_sucursal',
    'ventas','venta_items','venta_pagos','movimientos',
    'proveedores','compras','compra_items',
    'producto_costos_historial','inventario_conteos',
    'inventario_conteo_items','audit_log'
  )
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
order by table_name, privilege_type;

-- Resultado esperado para la consulta 3:
-- CERO FILAS.

-- 4. RPCs de seguridad.
select
    routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'listar_productos_sucursal_seguro_v1',
    'listar_categorias_seguras_v1',
    'guardar_categoria_segura_v1',
    'eliminar_categoria_segura_v1',
    'guardar_producto_seguro_v1',
    'eliminar_producto_seguro_v1',
    'eliminar_todos_productos_seguro_v1',
    'importar_productos_seguro_v1',
    'confirmar_stock_por_scanner_v2'
  )
order by routine_name;
