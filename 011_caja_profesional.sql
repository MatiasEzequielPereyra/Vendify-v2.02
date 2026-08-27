-- ============================================================
-- Vendify v2.27 — Caja profesional
-- Ejecutar DESPUÉS de 010_multisucursal_stock.sql
-- ============================================================
begin;
create extension if not exists "pgcrypto";

create table if not exists public.cajas_sesiones (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    caja_id uuid not null references public.cajas(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,
    estado text not null default 'abierta' check (estado in ('abierta','cerrada')),
    fondo_inicial numeric(14,2) not null default 0 check (fondo_inicial >= 0),
    abierta_en timestamptz not null default now(),
    cerrada_en timestamptz,
    efectivo_declarado numeric(14,2),
    efectivo_esperado numeric(14,2),
    diferencia numeric(14,2),
    ventas_total numeric(14,2) not null default 0,
    ventas_efectivo numeric(14,2) not null default 0,
    ingresos_total numeric(14,2) not null default 0,
    retiros_total numeric(14,2) not null default 0,
    tickets integer not null default 0,
    nota_apertura text,
    nota_cierre text,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);
create unique index if not exists cajas_sesiones_caja_abierta_uniq on public.cajas_sesiones(caja_id) where estado='abierta';
create index if not exists cajas_sesiones_negocio_idx on public.cajas_sesiones(negocio_id, abierta_en desc);
create index if not exists cajas_sesiones_sucursal_idx on public.cajas_sesiones(sucursal_id, abierta_en desc);
create index if not exists cajas_sesiones_usuario_idx on public.cajas_sesiones(user_id, abierta_en desc);
alter table public.cajas_sesiones enable row level security;
drop policy if exists "cajas_sesiones_select_miembros" on public.cajas_sesiones;
create policy "cajas_sesiones_select_miembros" on public.cajas_sesiones for select using (public.es_miembro_negocio(negocio_id));

create table if not exists public.caja_movimientos (
    id uuid primary key default gen_random_uuid(),
    sesion_id uuid not null references public.cajas_sesiones(id) on delete cascade,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    caja_id uuid not null references public.cajas(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,
    tipo text not null check (tipo in ('ingreso','retiro')),
    monto numeric(14,2) not null check (monto > 0),
    motivo text not null,
    creado timestamptz not null default now()
);
create index if not exists caja_movimientos_sesion_idx on public.caja_movimientos(sesion_id, creado desc);
alter table public.caja_movimientos enable row level security;
drop policy if exists "caja_movimientos_select_miembros" on public.caja_movimientos;
create policy "caja_movimientos_select_miembros" on public.caja_movimientos for select using (public.es_miembro_negocio(negocio_id));

alter table public.ventas add column if not exists caja_sesion_id uuid references public.cajas_sesiones(id) on delete set null;
create index if not exists ventas_caja_sesion_idx on public.ventas(caja_sesion_id);

create or replace function public.listar_cajas_sucursal_v1(p_sucursal_id uuid)
returns table (id uuid,nombre text,activa boolean)
language plpgsql stable security definer set search_path=public as $$
declare v_negocio_id uuid;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  v_negocio_id:=public.negocio_actual_id();
  return query select c.id,c.nombre,c.activa from public.cajas c
  where c.negocio_id=v_negocio_id and c.sucursal_id=p_sucursal_id and c.activa=true
  order by c.creado,c.nombre;
end; $$;
revoke all on function public.listar_cajas_sucursal_v1(uuid) from public;
grant execute on function public.listar_cajas_sucursal_v1(uuid) to authenticated;

create or replace function public.obtener_estado_caja_v1(p_caja_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
 v_negocio_id uuid; v_caja public.cajas; v_sesion public.cajas_sesiones;
 v_ventas_total numeric:=0; v_ventas_efectivo numeric:=0; v_tickets integer:=0;
 v_ingresos numeric:=0; v_retiros numeric:=0; v_esperado numeric:=0;
 v_nombre_usuario text; v_role text;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 v_negocio_id:=public.negocio_actual_id();
 select * into v_caja from public.cajas c where c.id=p_caja_id and c.negocio_id=v_negocio_id and c.activa=true;
 if not found then raise exception 'Caja inexistente o inactiva'; end if;
 select * into v_sesion from public.cajas_sesiones cs where cs.caja_id=p_caja_id and cs.negocio_id=v_negocio_id and cs.estado='abierta' order by cs.abierta_en desc limit 1;
 select nm.rol into v_role from public.negocio_miembros nm where nm.negocio_id=v_negocio_id and nm.user_id=auth.uid() and nm.activo=true limit 1;
 if v_sesion.id is null then
   return jsonb_build_object('caja',jsonb_build_object('id',v_caja.id,'nombre',v_caja.nombre,'sucursal_id',v_caja.sucursal_id),'sesion',null,'es_mia',false,'puede_supervisar',v_role in ('owner','admin','manager'));
 end if;
 select coalesce(sum(v.total),0),coalesce(sum(v.total) filter(where lower(coalesce(v.medio_pago,''))='efectivo'),0),count(*)::integer
 into v_ventas_total,v_ventas_efectivo,v_tickets from public.ventas v where v.caja_sesion_id=v_sesion.id;
 select coalesce(sum(cm.monto) filter(where cm.tipo='ingreso'),0),coalesce(sum(cm.monto) filter(where cm.tipo='retiro'),0)
 into v_ingresos,v_retiros from public.caja_movimientos cm where cm.sesion_id=v_sesion.id;
 v_esperado:=v_sesion.fondo_inicial+v_ventas_efectivo+v_ingresos-v_retiros;
 select coalesce(e.nombre,split_part(u.email,'@',1),'Usuario') into v_nombre_usuario
 from auth.users u left join public.empleados e on e.user_id=u.id and e.negocio_id=v_negocio_id where u.id=v_sesion.user_id;
 return jsonb_build_object(
  'caja',jsonb_build_object('id',v_caja.id,'nombre',v_caja.nombre,'sucursal_id',v_caja.sucursal_id),
  'sesion',jsonb_build_object('id',v_sesion.id,'user_id',v_sesion.user_id,'usuario_nombre',coalesce(v_nombre_usuario,'Usuario'),'fondo_inicial',v_sesion.fondo_inicial,'abierta_en',v_sesion.abierta_en,'nota_apertura',v_sesion.nota_apertura,'ventas_total',v_ventas_total,'ventas_efectivo',v_ventas_efectivo,'tickets',v_tickets,'ingresos_total',v_ingresos,'retiros_total',v_retiros,'efectivo_esperado',v_esperado),
  'es_mia',v_sesion.user_id=auth.uid(),'puede_supervisar',v_role in ('owner','admin','manager'));
end; $$;
revoke all on function public.obtener_estado_caja_v1(uuid) from public;
grant execute on function public.obtener_estado_caja_v1(uuid) to authenticated;

create or replace function public.abrir_caja_v1(p_caja_id uuid,p_fondo_inicial numeric default 0,p_nota text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_negocio_id uuid; v_caja public.cajas; v_sesion public.cajas_sesiones;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if p_fondo_inicial is null or p_fondo_inicial<0 then raise exception 'Fondo inicial inválido'; end if;
 v_negocio_id:=public.negocio_actual_id();
 if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin','manager','cashier']) then raise exception 'No tenés permiso para operar caja'; end if;
 select * into v_caja from public.cajas c where c.id=p_caja_id and c.negocio_id=v_negocio_id and c.activa=true;
 if not found then raise exception 'Caja inexistente o inactiva'; end if;
 if exists(select 1 from public.cajas_sesiones cs where cs.caja_id=p_caja_id and cs.estado='abierta') then raise exception 'Esta caja ya tiene un turno abierto'; end if;
 insert into public.cajas_sesiones(negocio_id,sucursal_id,caja_id,user_id,fondo_inicial,nota_apertura)
 values(v_negocio_id,v_caja.sucursal_id,v_caja.id,auth.uid(),round(p_fondo_inicial,2),nullif(trim(coalesce(p_nota,'')),'')) returning * into v_sesion;
 insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
 values(v_negocio_id,auth.uid(),'caja_abierta','cajas_sesiones',v_sesion.id,jsonb_build_object('caja_id',v_caja.id,'sucursal_id',v_caja.sucursal_id,'fondo_inicial',v_sesion.fondo_inicial));
 return public.obtener_estado_caja_v1(p_caja_id);
end; $$;
revoke all on function public.abrir_caja_v1(uuid,numeric,text) from public;
grant execute on function public.abrir_caja_v1(uuid,numeric,text) to authenticated;

create or replace function public.registrar_movimiento_caja_v1(p_caja_id uuid,p_tipo text,p_monto numeric,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_negocio_id uuid; v_sesion public.cajas_sesiones; v_role text;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if p_tipo not in ('ingreso','retiro') then raise exception 'Tipo de movimiento inválido'; end if;
 if p_monto is null or p_monto<=0 then raise exception 'Monto inválido'; end if;
 if length(trim(coalesce(p_motivo,'')))<2 then raise exception 'Ingresá un motivo'; end if;
 v_negocio_id:=public.negocio_actual_id();
 select nm.rol into v_role from public.negocio_miembros nm where nm.negocio_id=v_negocio_id and nm.user_id=auth.uid() and nm.activo=true limit 1;
 select * into v_sesion from public.cajas_sesiones cs where cs.caja_id=p_caja_id and cs.negocio_id=v_negocio_id and cs.estado='abierta' for update;
 if not found then raise exception 'La caja no está abierta'; end if;
 if v_sesion.user_id<>auth.uid() and coalesce(v_role,'') not in ('owner','admin','manager') then raise exception 'La caja está abierta por otro usuario'; end if;
 insert into public.caja_movimientos(sesion_id,negocio_id,sucursal_id,caja_id,user_id,tipo,monto,motivo)
 values(v_sesion.id,v_negocio_id,v_sesion.sucursal_id,v_sesion.caja_id,auth.uid(),p_tipo,round(p_monto,2),trim(p_motivo));
 insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
 values(v_negocio_id,auth.uid(),'movimiento_caja','cajas_sesiones',v_sesion.id,jsonb_build_object('tipo',p_tipo,'monto',round(p_monto,2),'motivo',trim(p_motivo)));
 return public.obtener_estado_caja_v1(p_caja_id);
end; $$;
revoke all on function public.registrar_movimiento_caja_v1(uuid,text,numeric,text) from public;
grant execute on function public.registrar_movimiento_caja_v1(uuid,text,numeric,text) to authenticated;

create or replace function public.cerrar_caja_v1(p_caja_id uuid,p_efectivo_declarado numeric,p_nota text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_negocio_id uuid; v_sesion public.cajas_sesiones; v_role text;
 v_ventas_total numeric:=0; v_ventas_efectivo numeric:=0; v_tickets integer:=0;
 v_ingresos numeric:=0; v_retiros numeric:=0; v_esperado numeric:=0; v_diferencia numeric:=0;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if p_efectivo_declarado is null or p_efectivo_declarado<0 then raise exception 'Efectivo declarado inválido'; end if;
 v_negocio_id:=public.negocio_actual_id();
 select nm.rol into v_role from public.negocio_miembros nm where nm.negocio_id=v_negocio_id and nm.user_id=auth.uid() and nm.activo=true limit 1;
 select * into v_sesion from public.cajas_sesiones cs where cs.caja_id=p_caja_id and cs.negocio_id=v_negocio_id and cs.estado='abierta' for update;
 if not found then raise exception 'La caja no está abierta'; end if;
 if v_sesion.user_id<>auth.uid() and coalesce(v_role,'') not in ('owner','admin','manager') then raise exception 'Solo quien abrió la caja puede cerrarla'; end if;
 select coalesce(sum(v.total),0),coalesce(sum(v.total) filter(where lower(coalesce(v.medio_pago,''))='efectivo'),0),count(*)::integer
 into v_ventas_total,v_ventas_efectivo,v_tickets from public.ventas v where v.caja_sesion_id=v_sesion.id;
 select coalesce(sum(cm.monto) filter(where cm.tipo='ingreso'),0),coalesce(sum(cm.monto) filter(where cm.tipo='retiro'),0)
 into v_ingresos,v_retiros from public.caja_movimientos cm where cm.sesion_id=v_sesion.id;
 v_esperado:=v_sesion.fondo_inicial+v_ventas_efectivo+v_ingresos-v_retiros;
 v_diferencia:=round(p_efectivo_declarado-v_esperado,2);
 update public.cajas_sesiones set estado='cerrada',cerrada_en=now(),efectivo_declarado=round(p_efectivo_declarado,2),efectivo_esperado=round(v_esperado,2),diferencia=v_diferencia,ventas_total=round(v_ventas_total,2),ventas_efectivo=round(v_ventas_efectivo,2),ingresos_total=round(v_ingresos,2),retiros_total=round(v_retiros,2),tickets=v_tickets,nota_cierre=nullif(trim(coalesce(p_nota,'')),''),actualizado=now()
 where id=v_sesion.id returning * into v_sesion;
 insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
 values(v_negocio_id,auth.uid(),'caja_cerrada','cajas_sesiones',v_sesion.id,jsonb_build_object('efectivo_esperado',v_sesion.efectivo_esperado,'efectivo_declarado',v_sesion.efectivo_declarado,'diferencia',v_sesion.diferencia,'ventas_total',v_sesion.ventas_total,'tickets',v_sesion.tickets));
 return jsonb_build_object('ok',true,'sesion',to_jsonb(v_sesion));
end; $$;
revoke all on function public.cerrar_caja_v1(uuid,numeric,text) from public;
grant execute on function public.cerrar_caja_v1(uuid,numeric,text) to authenticated;

create or replace function public.listar_movimientos_caja_abierta_v1(p_caja_id uuid)
returns table(id uuid,tipo text,monto numeric,motivo text,creado timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare v_negocio_id uuid; v_sesion_id uuid;
begin
 v_negocio_id:=public.negocio_actual_id();
 select cs.id into v_sesion_id from public.cajas_sesiones cs where cs.caja_id=p_caja_id and cs.negocio_id=v_negocio_id and cs.estado='abierta' limit 1;
 if v_sesion_id is null then return; end if;
 return query select cm.id,cm.tipo,cm.monto,cm.motivo,cm.creado from public.caja_movimientos cm where cm.sesion_id=v_sesion_id order by cm.creado desc limit 20;
end; $$;
revoke all on function public.listar_movimientos_caja_abierta_v1(uuid) from public;
grant execute on function public.listar_movimientos_caja_abierta_v1(uuid) to authenticated;

create or replace function public.listar_historial_cajas_v1(p_sucursal_id uuid,p_limit integer default 20)
returns table(id uuid,caja_id uuid,caja_nombre text,user_id uuid,usuario_nombre text,abierta_en timestamptz,cerrada_en timestamptz,fondo_inicial numeric,ventas_total numeric,ventas_efectivo numeric,ingresos_total numeric,retiros_total numeric,efectivo_esperado numeric,efectivo_declarado numeric,diferencia numeric,tickets integer)
language plpgsql stable security definer set search_path=public as $$
declare v_negocio_id uuid;
begin
 v_negocio_id:=public.negocio_actual_id();
 return query select cs.id,cs.caja_id,c.nombre,cs.user_id,coalesce(e.nombre,split_part(u.email,'@',1),'Usuario'),cs.abierta_en,cs.cerrada_en,cs.fondo_inicial,cs.ventas_total,cs.ventas_efectivo,cs.ingresos_total,cs.retiros_total,cs.efectivo_esperado,cs.efectivo_declarado,cs.diferencia,cs.tickets
 from public.cajas_sesiones cs join public.cajas c on c.id=cs.caja_id join auth.users u on u.id=cs.user_id left join public.empleados e on e.user_id=cs.user_id and e.negocio_id=cs.negocio_id
 where cs.negocio_id=v_negocio_id and cs.sucursal_id=p_sucursal_id and cs.estado='cerrada'
 order by cs.cerrada_en desc nulls last limit greatest(1,least(coalesce(p_limit,20),100));
end; $$;
revoke all on function public.listar_historial_cajas_v1(uuid,integer) from public;
grant execute on function public.listar_historial_cajas_v1(uuid,integer) to authenticated;

-- Venta: misma firma, requiere turno abierto de quien vende.
create or replace function public.registrar_venta_v2(p_items jsonb,p_medio_pago text default null,p_sucursal_id uuid default null,p_caja_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_negocio_id uuid; v_sucursal_id uuid; v_caja_id uuid; v_sesion public.cajas_sesiones; v_total numeric:=0;
 v_venta public.ventas; v_item record; v_producto public.productos; v_stock public.producto_stock_sucursal;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'El carrito está vacío'; end if;
 v_negocio_id:=public.negocio_actual_id();
 if not public.tiene_rol_negocio(v_negocio_id,array['owner','admin','manager','cashier']) then raise exception 'No tenés permiso para registrar ventas'; end if;
 if p_sucursal_id is null then raise exception 'Seleccioná una sucursal'; end if;
 select s.id into v_sucursal_id from public.sucursales s where s.id=p_sucursal_id and s.negocio_id=v_negocio_id and s.activa=true;
 if v_sucursal_id is null then raise exception 'Sucursal inválida'; end if;
 if p_caja_id is null then raise exception 'Seleccioná una caja'; end if;
 select c.id into v_caja_id from public.cajas c where c.id=p_caja_id and c.negocio_id=v_negocio_id and c.sucursal_id=v_sucursal_id and c.activa=true;
 if v_caja_id is null then raise exception 'Caja inválida'; end if;
 select * into v_sesion from public.cajas_sesiones cs where cs.caja_id=v_caja_id and cs.negocio_id=v_negocio_id and cs.sucursal_id=v_sucursal_id and cs.estado='abierta' for update;
 if not found then raise exception 'Abrí la caja antes de registrar ventas'; end if;
 if v_sesion.user_id<>auth.uid() then raise exception 'La caja está abierta por otro usuario'; end if;
 for v_item in select (x->>'producto_id')::uuid producto_id,sum((x->>'cantidad')::integer)::integer cantidad from jsonb_array_elements(p_items)x group by (x->>'producto_id')::uuid loop
  if v_item.cantidad is null or v_item.cantidad<=0 then raise exception 'Cantidad inválida'; end if;
  select * into v_producto from public.productos where id=v_item.producto_id and negocio_id=v_negocio_id;
  if not found then raise exception 'Producto no encontrado'; end if;
  select * into v_stock from public.producto_stock_sucursal where producto_id=v_producto.id and sucursal_id=v_sucursal_id and negocio_id=v_negocio_id for update;
  if not found then raise exception 'El producto "%" no tiene stock configurado en esta sucursal',v_producto.nombre; end if;
  if v_stock.stock<v_item.cantidad then raise exception 'Stock insuficiente de "%": quedan % unidades',v_producto.nombre,v_stock.stock; end if;
 end loop;
 insert into public.ventas(user_id,negocio_id,sucursal_id,caja_id,caja_sesion_id,total,medio_pago)
 values(auth.uid(),v_negocio_id,v_sucursal_id,v_caja_id,v_sesion.id,0,p_medio_pago) returning * into v_venta;
 for v_item in select (x->>'producto_id')::uuid producto_id,sum((x->>'cantidad')::integer)::integer cantidad from jsonb_array_elements(p_items)x group by (x->>'producto_id')::uuid loop
  select * into v_producto from public.productos where id=v_item.producto_id and negocio_id=v_negocio_id;
  update public.producto_stock_sucursal set stock=stock-v_item.cantidad,actualizado=now() where producto_id=v_item.producto_id and sucursal_id=v_sucursal_id and negocio_id=v_negocio_id and stock>=v_item.cantidad returning * into v_stock;
  if not found then raise exception 'No se pudo descontar stock de forma segura'; end if;
  insert into public.venta_items(venta_id,user_id,negocio_id,producto_id,producto_nombre,cantidad,precio_unitario,costo_unitario,subtotal)
  values(v_venta.id,auth.uid(),v_negocio_id,v_producto.id,v_producto.nombre,v_item.cantidad,v_producto.precio_venta,v_producto.precio_compra,v_producto.precio_venta*v_item.cantidad);
  insert into public.movimientos(user_id,negocio_id,sucursal_id,producto_id,producto_nombre,tipo,delta,stock_resultante)
  values(auth.uid(),v_negocio_id,v_sucursal_id,v_producto.id,v_producto.nombre,'venta',-v_item.cantidad,v_stock.stock);
  v_total:=v_total+(v_producto.precio_venta*v_item.cantidad);
 end loop;
 update public.ventas set total=v_total where id=v_venta.id returning * into v_venta;
 return jsonb_build_object('venta',to_jsonb(v_venta),'negocio_id',v_negocio_id,'sucursal_id',v_sucursal_id,'caja_id',v_caja_id,'caja_sesion_id',v_sesion.id);
end; $$;
revoke all on function public.registrar_venta_v2(jsonb,text,uuid,uuid) from public;
grant execute on function public.registrar_venta_v2(jsonb,text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
