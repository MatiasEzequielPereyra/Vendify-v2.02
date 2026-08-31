-- ============================================================
-- Vendify v2.30.1.4 — Permisos de Stock por Empleado
-- ============================================================

begin;

alter table public.negocio_miembros
    add column if not exists puede_gestionar_stock boolean;

-- Backfill conservador: preserva la experiencia de usuarios existentes.
update public.negocio_miembros
set puede_gestionar_stock =
    case
      when rol in ('owner','admin','manager') then true
      else false
    end
where puede_gestionar_stock is null;

update public.negocio_miembros
set puede_gestionar_stock = true
where rol = 'owner'
  and puede_gestionar_stock is distinct from true;

alter table public.negocio_miembros
    alter column puede_gestionar_stock set default false;

alter table public.negocio_miembros
    alter column puede_gestionar_stock set not null;


create or replace function public.puede_modificar_stock_manual_v1(
    p_negocio_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.negocio_miembros nm
        where nm.negocio_id = p_negocio_id
          and nm.user_id = auth.uid()
          and nm.activo = true
          and (
              nm.rol = 'owner'
              or nm.puede_gestionar_stock = true
          )
    );
$$;

revoke all on function public.puede_modificar_stock_manual_v1(uuid) from public;
grant execute on function public.puede_modificar_stock_manual_v1(uuid) to authenticated;


create or replace function public.obtener_permisos_personalizados_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_miembro public.negocio_miembros;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    select nm.*
      into v_miembro
      from public.negocio_miembros nm
     where nm.user_id = auth.uid()
       and nm.activo = true
     order by
       case nm.rol
         when 'owner' then 1
         when 'admin' then 2
         when 'manager' then 3
         else 4
       end,
       nm.creado
     limit 1;

    if v_miembro.id is null then
        raise exception 'Membresía activa inexistente';
    end if;

    return jsonb_build_object(
        'adjustStock',
        case
          when v_miembro.rol = 'owner' then true
          else coalesce(v_miembro.puede_gestionar_stock,false)
        end,
        'manualStock',
        case
          when v_miembro.rol = 'owner' then true
          else coalesce(v_miembro.puede_gestionar_stock,false)
        end
    );
end;
$$;

revoke all on function public.obtener_permisos_personalizados_v1() from public;
grant execute on function public.obtener_permisos_personalizados_v1() to authenticated;


create or replace function public.listar_permisos_stock_equipo_v1()
returns table (
    membership_id uuid,
    puede_gestionar_stock boolean
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

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para ver permisos del equipo';
    end if;

    return query
    select
        nm.id,
        case
          when nm.rol = 'owner' then true
          else coalesce(nm.puede_gestionar_stock,false)
        end
    from public.negocio_miembros nm
    where nm.negocio_id = v_negocio_id
    order by nm.creado;
end;
$$;

revoke all on function public.listar_permisos_stock_equipo_v1() from public;
grant execute on function public.listar_permisos_stock_equipo_v1() to authenticated;


create or replace function public.actualizar_permiso_stock_miembro_v1(
    p_membership_id uuid,
    p_permitir boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner']) then
        raise exception 'Solo el propietario puede cambiar permisos de stock';
    end if;

    select *
      into v_target
      from public.negocio_miembros nm
     where nm.id = p_membership_id
       and nm.negocio_id = v_negocio_id
     for update;

    if v_target.id is null then
        raise exception 'Empleado inexistente';
    end if;

    if v_target.rol = 'owner' then
        raise exception 'El permiso del propietario no puede desactivarse';
    end if;

    update public.negocio_miembros
       set puede_gestionar_stock = coalesce(p_permitir,false)
     where id = v_target.id;

    if to_regclass('public.audit_log') is not null then
        insert into public.audit_log(
            negocio_id,user_id,accion,entidad,entidad_id,detalle
        )
        values(
            v_negocio_id,
            auth.uid(),
            'permiso_stock_actualizado',
            'negocio_miembros',
            v_target.id,
            jsonb_build_object(
                'target_user_id',v_target.user_id,
                'rol',v_target.rol,
                'permitido',coalesce(p_permitir,false)
            )
        );
    end if;

    return jsonb_build_object(
        'ok',true,
        'membership_id',v_target.id,
        'puede_gestionar_stock',coalesce(p_permitir,false)
    );
end;
$$;

revoke all on function public.actualizar_permiso_stock_miembro_v1(uuid,boolean) from public;
grant execute on function public.actualizar_permiso_stock_miembro_v1(uuid,boolean) to authenticated;


create or replace function public.ajustar_stock_inventario_v2(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_modo text,
    p_cantidad integer,
    p_motivo text,
    p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_anterior integer;
    v_nuevo integer;
    v_delta integer;
    v_tipo text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.puede_modificar_stock_manual_v1(v_negocio_id) then
        raise exception 'No tenés permiso para modificar inventario';
    end if;

    if p_modo not in ('sumar','restar','establecer') then
        raise exception 'Operación de stock inválida';
    end if;

    if p_cantidad is null or p_cantidad < 0 then
        raise exception 'Cantidad inválida';
    end if;

    if p_motivo not in (
        'reposicion','correccion','rotura','vencimiento','perdida','inventario'
    ) then
        raise exception 'Motivo de inventario inválido';
    end if;

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if not found then
        raise exception 'Producto inexistente';
    end if;

    if not exists (
        select 1
        from public.sucursales s
        where s.id = p_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    select *
      into v_stock
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if not found then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(v_producto.stock_minimo,0),0)
        )
        returning * into v_stock;
    end if;

    v_anterior := v_stock.stock;

    if p_modo = 'sumar' then
        v_nuevo := v_anterior + p_cantidad;
    elsif p_modo = 'restar' then
        v_nuevo := v_anterior - p_cantidad;
    else
        v_nuevo := p_cantidad;
    end if;

    if v_nuevo < 0 then
        raise exception 'Stock insuficiente. Disponible: %', v_anterior;
    end if;

    v_delta := v_nuevo - v_anterior;

    if v_delta = 0 then
        return jsonb_build_object(
            'ok', true,
            'stock', v_anterior,
            'delta', 0,
            'sin_cambios', true
        );
    end if;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_stock.id;

    v_tipo :=
        case p_motivo
            when 'reposicion' then 'ingreso'
            when 'rotura' then 'rotura'
            when 'vencimiento' then 'vencimiento'
            when 'perdida' then 'perdida'
            when 'inventario' then 'inventario'
            else 'ajuste'
        end;

    insert into public.movimientos(
        user_id,
        negocio_id,
        sucursal_id,
        producto_id,
        producto_nombre,
        tipo,
        delta,
        stock_resultante,
        motivo,
        detalle
    )
    values(
        auth.uid(),
        v_negocio_id,
        p_sucursal_id,
        v_producto.id,
        v_producto.nombre,
        v_tipo,
        v_delta,
        v_nuevo,
        case p_motivo
            when 'reposicion' then 'Reposición / ingreso'
            when 'correccion' then 'Corrección de stock'
            when 'rotura' then 'Rotura'
            when 'vencimiento' then 'Vencimiento'
            when 'perdida' then 'Pérdida / merma'
            when 'inventario' then 'Conteo físico'
            else p_motivo
        end,
        jsonb_build_object(
            'modo', p_modo,
            'stock_anterior', v_anterior,
            'stock_nuevo', v_nuevo,
            'nota', nullif(trim(coalesce(p_nota,'')),'')
        )
    );

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'stock_ajustado',
        'productos',
        v_producto.id,
        jsonb_build_object(
            'sucursal_id',p_sucursal_id,
            'motivo',p_motivo,
            'stock_anterior',v_anterior,
            'stock_nuevo',v_nuevo,
            'delta',v_delta
        )
    );

    return jsonb_build_object(
        'ok', true,
        'stock', v_nuevo,
        'stock_anterior', v_anterior,
        'delta', v_delta,
        'tipo', v_tipo
    );
end;
$$;

revoke all on function public.ajustar_stock_inventario_v2(
    uuid,uuid,text,integer,text,text
) from public;
grant execute on function public.ajustar_stock_inventario_v2(
    uuid,uuid,text,integer,text,text
) to authenticated;


create or replace function public.aplicar_conteo_fisico_v2(
    p_sucursal_id uuid,
    p_items jsonb,
    p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_conteo public.inventario_conteos;
    v_item record;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_contado integer;
    v_anterior integer;
    v_delta integer;
    v_contados integer := 0;
    v_ajustados integer := 0;
    v_pos integer := 0;
    v_neg integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.puede_modificar_stock_manual_v1(v_negocio_id) then
        raise exception 'No tenés permiso para realizar conteos';
    end if;

    if not exists (
        select 1
        from public.sucursales s
        where s.id = p_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'Ingresá al menos un producto contado';
    end if;

    insert into public.inventario_conteos(
        negocio_id,sucursal_id,user_id,nota
    )
    values(
        v_negocio_id,
        p_sucursal_id,
        auth.uid(),
        nullif(trim(coalesce(p_nota,'')),'')
    )
    returning * into v_conteo;

    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            (x->>'stock_contado')::integer as stock_contado
        from jsonb_array_elements(p_items) x
    loop
        v_contado := v_item.stock_contado;

        if v_contado is null or v_contado < 0 then
            raise exception 'Cantidad contada inválida';
        end if;

        select *
          into v_producto
          from public.productos p
         where p.id = v_item.producto_id
           and p.negocio_id = v_negocio_id;

        if not found then
            raise exception 'Producto inválido en el conteo';
        end if;

        select *
          into v_stock
          from public.producto_stock_sucursal ps
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = p_sucursal_id
           and ps.producto_id = v_producto.id
         for update;

        if not found then
            insert into public.producto_stock_sucursal(
                negocio_id,sucursal_id,producto_id,stock,stock_minimo
            )
            values(
                v_negocio_id,p_sucursal_id,v_producto.id,0,
                greatest(coalesce(v_producto.stock_minimo,0),0)
            )
            returning * into v_stock;
        end if;

        v_anterior := v_stock.stock;
        v_delta := v_contado - v_anterior;

        insert into public.inventario_conteo_items(
            conteo_id,
            negocio_id,
            sucursal_id,
            producto_id,
            stock_sistema,
            stock_contado,
            diferencia
        )
        values(
            v_conteo.id,
            v_negocio_id,
            p_sucursal_id,
            v_producto.id,
            v_anterior,
            v_contado,
            v_delta
        );

        v_contados := v_contados + 1;

        if v_delta <> 0 then
            update public.producto_stock_sucursal
               set stock = v_contado,
                   actualizado = now()
             where id = v_stock.id;

            insert into public.movimientos(
                user_id,
                negocio_id,
                sucursal_id,
                producto_id,
                producto_nombre,
                tipo,
                delta,
                stock_resultante,
                motivo,
                detalle
            )
            values(
                auth.uid(),
                v_negocio_id,
                p_sucursal_id,
                v_producto.id,
                v_producto.nombre,
                'inventario',
                v_delta,
                v_contado,
                'Conteo físico',
                jsonb_build_object(
                    'conteo_id',v_conteo.id,
                    'stock_sistema',v_anterior,
                    'stock_contado',v_contado,
                    'nota',nullif(trim(coalesce(p_nota,'')),'')
                )
            );

            v_ajustados := v_ajustados + 1;

            if v_delta > 0 then
                v_pos := v_pos + v_delta;
            else
                v_neg := v_neg + abs(v_delta);
            end if;
        end if;
    end loop;

    update public.inventario_conteos
       set productos_contados = v_contados,
           productos_ajustados = v_ajustados,
           diferencia_positiva = v_pos,
           diferencia_negativa = v_neg
     where id = v_conteo.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'conteo_fisico_aplicado',
        'inventario_conteos',
        v_conteo.id,
        jsonb_build_object(
            'sucursal_id',p_sucursal_id,
            'productos_contados',v_contados,
            'productos_ajustados',v_ajustados,
            'diferencia_positiva',v_pos,
            'diferencia_negativa',v_neg
        )
    );

    return jsonb_build_object(
        'ok',true,
        'conteo_id',v_conteo.id,
        'productos_contados',v_contados,
        'productos_ajustados',v_ajustados,
        'diferencia_positiva',v_pos,
        'diferencia_negativa',v_neg
    );
end;
$$;

revoke all on function public.aplicar_conteo_fisico_v2(
    uuid,jsonb,text
) from public;
grant execute on function public.aplicar_conteo_fisico_v2(
    uuid,jsonb,text
) to authenticated;


create or replace function public.ajustar_stock_inicial_rapido_v2(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_delta integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_row public.producto_stock_sucursal;
    v_nuevo integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.puede_modificar_stock_manual_v1(v_negocio_id) then
        raise exception 'No tenés permiso para modificar stock';
    end if;

    if p_delta not in (-1,1) then
        raise exception 'El ajuste rápido solo admite una unidad por vez';
    end if;

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_producto.id is null then
        raise exception 'Producto inexistente';
    end if;

    select *
      into v_row
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if v_row.id is null then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo,
            stock_inicial_cerrado
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(v_producto.stock_minimo,0),0),false
        )
        returning * into v_row;
    end if;

    if v_row.stock_inicial_cerrado then
        return jsonb_build_object(
            'ok',true,
            'requiere_motivo',true,
            'stock',v_row.stock
        );
    end if;

    v_nuevo := v_row.stock + p_delta;

    if v_nuevo < 0 then
        return jsonb_build_object(
            'ok',false,
            'requiere_motivo',false,
            'stock',v_row.stock,
            'message','El stock no puede ser negativo'
        );
    end if;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_row.id;

    insert into public.movimientos(
        user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
        tipo,delta,stock_resultante,motivo,detalle
    )
    values(
        auth.uid(),v_negocio_id,p_sucursal_id,v_producto.id,v_producto.nombre,
        'stock_inicial',p_delta,v_nuevo,'Carga inicial de stock',
        jsonb_build_object(
            'origen','boton_rapido',
            'delta',p_delta
        )
    );

    return jsonb_build_object(
        'ok',true,
        'requiere_motivo',false,
        'stock',v_nuevo,
        'stock_inicial',true
    );
end;
$$;

revoke all on function public.ajustar_stock_inicial_rapido_v2(
    uuid,uuid,integer
) from public;
grant execute on function public.ajustar_stock_inicial_rapido_v2(
    uuid,uuid,integer
) to authenticated;


create or replace function public.guardar_producto_seguro_v2(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_nombre text,
    p_marca text,
    p_presentacion text,
    p_codigo_barras text,
    p_categoria text,
    p_precio_compra numeric,
    p_precio_venta numeric,
    p_stock integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_stock_actual integer := 0;
    v_stock_resultante integer := 0;
    v_result jsonb;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para modificar productos';
    end if;

    if not exists (
        select 1
          from public.sucursales s
         where s.id = p_sucursal_id
           and s.negocio_id = v_negocio_id
           and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    v_nombre := nullif(trim(coalesce(p_nombre,'')),'');
    if v_nombre is null then
        return jsonb_build_object(
            'ok',false,
            'message','El nombre es obligatorio'
        );
    end if;

    if coalesce(p_stock,0) < 0
       or coalesce(p_precio_compra,0) < 0
       or coalesce(p_precio_venta,0) < 0 then
        return jsonb_build_object(
            'ok',false,
            'message','Stock y precios no pueden ser negativos'
        );
    end if;

    if nullif(trim(coalesce(p_codigo_barras,'')),'') is not null
       and exists (
          select 1
            from public.productos p
           where p.negocio_id = v_negocio_id
             and p.codigo_barras = trim(p_codigo_barras)
             and (p_producto_id is null or p.id <> p_producto_id)
       ) then
        return jsonb_build_object(
            'ok',false,
            'message','Ese código de barras ya está cargado'
        );
    end if;

    if p_producto_id is null then
        insert into public.productos(
            negocio_id,
            user_id,
            nombre,
            marca,
            presentacion,
            codigo_barras,
            categoria,
            precio_compra,
            precio_venta,
            stock,
            stock_minimo
        )
        values(
            v_negocio_id,
            auth.uid(),
            v_nombre,
            coalesce(trim(p_marca),''),
            coalesce(trim(p_presentacion),''),
            nullif(trim(coalesce(p_codigo_barras,'')),''),
            coalesce(trim(p_categoria),''),
            round(coalesce(p_precio_compra,0),2),
            round(coalesce(p_precio_venta,0),2),
            0,
            0
        )
        returning * into v_producto;

        if coalesce(p_stock,0) > 0
           and not public.puede_modificar_stock_manual_v1(v_negocio_id) then
            raise exception 'El propietario no habilitó la carga manual de stock para tu usuario';
        end if;

        v_result := public.establecer_stock_inicial_v1(
            v_producto.id,
            p_sucursal_id,
            coalesce(p_stock,0),
            0
        );

        v_stock_resultante := coalesce(
            (v_result->>'stock')::integer,
            p_stock,
            0
        );

        insert into public.audit_log(
            negocio_id,user_id,accion,entidad,entidad_id,detalle
        )
        values(
            v_negocio_id,
            auth.uid(),
            'producto_creado',
            'productos',
            v_producto.id,
            jsonb_build_object(
                'sucursal_id',p_sucursal_id,
                'stock_inicial',v_stock_resultante
            )
        );

    else
        select *
          into v_producto
          from public.productos p
         where p.id = p_producto_id
           and p.negocio_id = v_negocio_id
         for update;

        if v_producto.id is null then
            raise exception 'Producto inexistente';
        end if;

        select coalesce(ps.stock,0)
          into v_stock_actual
          from public.producto_stock_sucursal ps
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = p_sucursal_id
           and ps.producto_id = v_producto.id;

        update public.productos
           set nombre = v_nombre,
               marca = coalesce(trim(p_marca),''),
               presentacion = coalesce(trim(p_presentacion),''),
               codigo_barras = nullif(trim(coalesce(p_codigo_barras,'')),''),
               categoria = coalesce(trim(p_categoria),''),
               precio_compra = round(coalesce(p_precio_compra,0),2),
               precio_venta = round(coalesce(p_precio_venta,0),2),
               actualizado = now()
         where id = v_producto.id
        returning * into v_producto;

        if coalesce(p_stock,0) <> coalesce(v_stock_actual,0) then
            if not public.puede_modificar_stock_manual_v1(v_negocio_id) then
                raise exception 'El propietario no habilitó la modificación manual de stock para tu usuario';
            end if;

            v_result := public.ajustar_stock_inventario_v2(
                v_producto.id,
                p_sucursal_id,
                'establecer',
                coalesce(p_stock,0),
                'correccion',
                'Cambio desde edición de producto'
            );

            v_stock_resultante := coalesce(
                (v_result->>'stock')::integer,
                p_stock,
                0
            );
        else
            v_stock_resultante := coalesce(v_stock_actual,0);
        end if;

        insert into public.audit_log(
            negocio_id,user_id,accion,entidad,entidad_id,detalle
        )
        values(
            v_negocio_id,
            auth.uid(),
            'producto_actualizado',
            'productos',
            v_producto.id,
            jsonb_build_object(
                'sucursal_id',p_sucursal_id
            )
        );
    end if;

    return jsonb_build_object(
        'ok',true,
        'producto',
        to_jsonb(v_producto)
        || jsonb_build_object(
            'stock',v_stock_resultante,
            'stock_minimo',0
        )
    );

exception
    when unique_violation then
        return jsonb_build_object(
            'ok',false,
            'message','El producto o código de barras ya existe'
        );
end;
$$;

revoke all on function public.guardar_producto_seguro_v2(
    uuid,uuid,text,text,text,text,text,numeric,numeric,integer
) from public;
grant execute on function public.guardar_producto_seguro_v2(
    uuid,uuid,text,text,text,text,text,numeric,numeric,integer
) to authenticated;

notify pgrst, 'reload schema';

commit;
