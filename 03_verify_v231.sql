-- ============================================================
-- VENDIFY v2.31.0 — VERIFICACIÓN POST-MIGRACIÓN
-- Ejecutar DESPUÉS de 02_v231_commercial_foundation.sql
-- ============================================================

-- 1. Objetos principales.
select
    objeto,
    existe
from (
    values
      ('vendify_config_operativa',
        to_regclass('public.vendify_config_operativa') is not null),
      ('vendify_planes',
        to_regclass('public.vendify_planes') is not null),
      ('vendify_suscripciones',
        to_regclass('public.vendify_suscripciones') is not null),
      ('vendify_error_logs',
        to_regclass('public.vendify_error_logs') is not null),
      ('vendify_platform_admins',
        to_regclass('public.vendify_platform_admins') is not null),

      ('dashboard_propietario_v1',
        to_regprocedure('public.dashboard_propietario_v1(uuid,integer)') is not null),
      ('alertas_operativas_v1',
        to_regprocedure('public.alertas_operativas_v1(uuid)') is not null),
      ('recomendaciones_reposicion_v1',
        to_regprocedure('public.recomendaciones_reposicion_v1(uuid,integer)') is not null),
      ('estado_onboarding_comercial_v1',
        to_regprocedure('public.estado_onboarding_comercial_v1()') is not null),
      ('obtener_plan_actual_v1',
        to_regprocedure('public.obtener_plan_actual_v1()') is not null),
      ('validar_limite_plan_v1',
        to_regprocedure('public.validar_limite_plan_v1(uuid,text,integer)') is not null),
      ('registrar_error_cliente_v1',
        to_regprocedure('public.registrar_error_cliente_v1(text,text,text,jsonb)') is not null),
      ('importar_productos_masivo_v1',
        to_regprocedure('public.importar_productos_masivo_v1(uuid,jsonb)') is not null),
      ('exportar_respaldo_operativo_v1',
        to_regprocedure('public.exportar_respaldo_operativo_v1()') is not null)
) x(objeto,existe)
order by objeto;


-- 2. Todo debe devolver TRUE.
select
    bool_and(existe) as todos_los_objetos_principales_existen
from (
    values
      (to_regclass('public.vendify_config_operativa') is not null),
      (to_regclass('public.vendify_planes') is not null),
      (to_regclass('public.vendify_suscripciones') is not null),
      (to_regclass('public.vendify_error_logs') is not null),
      (to_regprocedure('public.dashboard_propietario_v1(uuid,integer)') is not null),
      (to_regprocedure('public.alertas_operativas_v1(uuid)') is not null),
      (to_regprocedure('public.estado_onboarding_comercial_v1()') is not null),
      (to_regprocedure('public.importar_productos_masivo_v1(uuid,jsonb)') is not null),
      (to_regprocedure('public.exportar_respaldo_operativo_v1()') is not null)
) x(existe);


-- 3. Planes comerciales.
select
    codigo,
    nombre,
    max_sucursales,
    max_usuarios,
    max_productos,
    trial_dias,
    activo
from public.vendify_planes
order by orden;


-- 4. Suscripciones inicializadas.
select
    count(*) as negocios,
    count(vs.negocio_id) as negocios_con_suscripcion
from public.negocios n
left join public.vendify_suscripciones vs
  on vs.negocio_id = n.id;


-- 5. Configuración operativa inicializada.
select
    count(*) as negocios,
    count(vc.negocio_id) as negocios_con_config
from public.negocios n
left join public.vendify_config_operativa vc
  on vc.negocio_id = n.id;


-- 6. Seguridad: tablas internas no deben tener grants directos
-- para authenticated.
select
    table_name,
    privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name in (
      'vendify_config_operativa',
      'vendify_suscripciones',
      'vendify_error_logs',
      'vendify_platform_admins'
  )
order by table_name,privilege_type;


-- 7. Platform Admin NO se habilita automáticamente.
-- Normalmente debe ser 0 hasta que vos decidas registrar una cuenta
-- de administración interna.
select count(*) as platform_admins
from public.vendify_platform_admins;


-- 8. Índices críticos.
select
    indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
      'ventas_dashboard_v231_idx',
      'movimientos_alertas_v231_idx',
      'venta_pagos_dashboard_v231_idx',
      'producto_stock_dashboard_v231_idx',
      'vendify_error_logs_negocio_fecha_idx'
  )
order by indexname;
