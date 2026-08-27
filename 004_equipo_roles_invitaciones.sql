-- ============================================================
-- Vendify v2.2 — Migración 004
-- Equipo real, invitaciones y roles seguros
-- Ejecutar DESPUÉS de 001, 002 y 003.
-- ============================================================

begin;

create table if not exists public.equipo_invitaciones (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    email text not null,
    rol text not null check (rol in ('admin','manager','cashier')),
    estado text not null default 'pending' check (estado in ('pending','accepted','cancelled')),
    invitado_por uuid references auth.users(id) on delete set null,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    aceptado timestamptz
);

create index if not exists equipo_invitaciones_negocio_idx
    on public.equipo_invitaciones(negocio_id, creado desc);
create index if not exists equipo_invitaciones_email_idx
    on public.equipo_invitaciones(lower(email));
create unique index if not exists equipo_invitaciones_email_pending_unique
    on public.equipo_invitaciones(lower(email))
    where estado = 'pending';

alter table public.equipo_invitaciones enable row level security;
drop policy if exists "equipo_invitaciones_select" on public.equipo_invitaciones;
drop policy if exists "equipo_invitaciones_write" on public.equipo_invitaciones;

-- Toda escritura de membresías pasa por RPCs seguras.
drop policy if exists "miembros_admin_insert" on public.negocio_miembros;
drop policy if exists "miembros_admin_update" on public.negocio_miembros;
drop policy if exists "miembros_owner_delete" on public.negocio_miembros;

create or replace function public.listar_equipo_v2()
returns table (
    record_id uuid,
    tipo text,
    user_id uuid,
    email text,
    rol text,
    activo boolean,
    estado text,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
    v_negocio_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para administrar el equipo';
    end if;

    return query
    select nm.id, 'miembro'::text, nm.user_id, u.email::text, nm.rol, nm.activo,
           case when nm.activo then 'active'::text else 'inactive'::text end, nm.creado
      from public.negocio_miembros nm
      join auth.users u on u.id = nm.user_id
     where nm.negocio_id = v_negocio_id

    union all

    select ei.id, 'invitacion'::text, null::uuid, ei.email, ei.rol, false, ei.estado, ei.creado
      from public.equipo_invitaciones ei
     where ei.negocio_id = v_negocio_id
       and ei.estado = 'pending'

    order by creado;
end;
$$;

revoke all on function public.listar_equipo_v2() from public;
grant execute on function public.listar_equipo_v2() to authenticated;

create or replace function public.invitar_miembro_v2(p_email text, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_negocio_id uuid;
    v_email text;
    v_user_id uuid;
    v_inv_id uuid;
    v_membership_id uuid;
begin
    if auth.uid() is null then raise exception 'Sesión requerida'; end if;

    v_negocio_id := public.negocio_actual_id();
    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para invitar empleados';
    end if;

    v_email := lower(trim(coalesce(p_email,'')));
    if v_email = '' or position('@' in v_email) < 2 then raise exception 'Email inválido'; end if;
    if p_rol not in ('admin','manager','cashier') then raise exception 'Rol inválido'; end if;

    select u.id into v_user_id from auth.users u where lower(u.email) = v_email limit 1;

    if v_user_id is not null then
        if exists (select 1 from public.negocio_miembros nm where nm.user_id=v_user_id and nm.negocio_id=v_negocio_id) then
            raise exception 'Ese usuario ya pertenece a tu equipo';
        end if;
        if exists (select 1 from public.negocio_miembros nm where nm.user_id=v_user_id and nm.negocio_id<>v_negocio_id and nm.activo=true) then
            raise exception 'Ese email ya está asociado a otro negocio de Vendify';
        end if;

        insert into public.negocio_miembros(negocio_id,user_id,rol,activo)
        values(v_negocio_id,v_user_id,p_rol,true)
        returning id into v_membership_id;

        update public.equipo_invitaciones
           set estado='accepted', aceptado=now(), actualizado=now()
         where lower(email)=v_email and estado='pending';

        insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
        values(v_negocio_id,auth.uid(),'miembro_agregado','negocio_miembros',v_membership_id,
               jsonb_build_object('email',v_email,'rol',p_rol));

        return jsonb_build_object('status','added','message','Usuario agregado al equipo','email',v_email,'rol',p_rol);
    end if;

    select ei.id into v_inv_id
      from public.equipo_invitaciones ei
     where lower(ei.email)=v_email and ei.estado='pending'
     limit 1;

    if v_inv_id is not null then
        update public.equipo_invitaciones
           set negocio_id=v_negocio_id, rol=p_rol, invitado_por=auth.uid(), actualizado=now()
         where id=v_inv_id;
    else
        insert into public.equipo_invitaciones(negocio_id,email,rol,estado,invitado_por)
        values(v_negocio_id,v_email,p_rol,'pending',auth.uid())
        returning id into v_inv_id;
    end if;

    insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
    values(v_negocio_id,auth.uid(),'invitacion_creada','equipo_invitaciones',v_inv_id,
           jsonb_build_object('email',v_email,'rol',p_rol));

    return jsonb_build_object(
        'status','pending',
        'message','Invitación guardada. La persona debe crear su cuenta con ese email.',
        'email',v_email,'rol',p_rol
    );
end;
$$;

revoke all on function public.invitar_miembro_v2(text,text) from public;
grant execute on function public.invitar_miembro_v2(text,text) to authenticated;

create or replace function public.actualizar_rol_miembro_v2(p_membership_id uuid, p_rol text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
begin
    v_negocio_id := public.negocio_actual_id();
    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para cambiar roles';
    end if;
    if p_rol not in ('admin','manager','cashier') then raise exception 'Rol inválido'; end if;

    select * into v_target
      from public.negocio_miembros
     where id=p_membership_id and negocio_id=v_negocio_id
     for update;

    if not found then raise exception 'Miembro inexistente'; end if;
    if v_target.rol='owner' then raise exception 'El propietario no puede cambiarse desde Equipo'; end if;
    if v_target.user_id=auth.uid() then raise exception 'No podés cambiar tu propio rol'; end if;

    update public.negocio_miembros set rol=p_rol where id=p_membership_id;

    insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
    values(v_negocio_id,auth.uid(),'rol_actualizado','negocio_miembros',p_membership_id,
           jsonb_build_object('rol_anterior',v_target.rol,'rol_nuevo',p_rol));

    return jsonb_build_object('ok',true,'rol',p_rol);
end;
$$;

revoke all on function public.actualizar_rol_miembro_v2(uuid,text) from public;
grant execute on function public.actualizar_rol_miembro_v2(uuid,text) to authenticated;

create or replace function public.cambiar_estado_miembro_v2(p_membership_id uuid, p_activo boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
begin
    v_negocio_id := public.negocio_actual_id();
    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para cambiar el estado de empleados';
    end if;

    select * into v_target
      from public.negocio_miembros
     where id=p_membership_id and negocio_id=v_negocio_id
     for update;

    if not found then raise exception 'Miembro inexistente'; end if;
    if v_target.rol='owner' then raise exception 'El propietario no puede desactivarse'; end if;
    if v_target.user_id=auth.uid() then raise exception 'No podés desactivar tu propio usuario'; end if;

    update public.negocio_miembros set activo=p_activo where id=p_membership_id;

    insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
    values(v_negocio_id,auth.uid(),
           case when p_activo then 'miembro_activado' else 'miembro_desactivado' end,
           'negocio_miembros',p_membership_id,
           jsonb_build_object('user_id',v_target.user_id,'activo',p_activo));

    return jsonb_build_object('ok',true,'activo',p_activo);
end;
$$;

revoke all on function public.cambiar_estado_miembro_v2(uuid,boolean) from public;
grant execute on function public.cambiar_estado_miembro_v2(uuid,boolean) to authenticated;

create or replace function public.cancelar_invitacion_v2(p_invitacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_email text;
begin
    v_negocio_id := public.negocio_actual_id();
    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para cancelar invitaciones';
    end if;

    update public.equipo_invitaciones
       set estado='cancelled', actualizado=now()
     where id=p_invitacion_id and negocio_id=v_negocio_id and estado='pending'
     returning email into v_email;

    if v_email is null then raise exception 'Invitación inexistente o ya procesada'; end if;

    insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
    values(v_negocio_id,auth.uid(),'invitacion_cancelada','equipo_invitaciones',p_invitacion_id,
           jsonb_build_object('email',v_email));

    return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.cancelar_invitacion_v2(uuid) from public;
grant execute on function public.cancelar_invitacion_v2(uuid) to authenticated;

-- El trigger ahora consume una invitación antes de crear un negocio nuevo.
create or replace function public.crear_entorno_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio_id uuid;
  v_sucursal_id uuid;
  v_nombre text;
  v_inv public.equipo_invitaciones;
begin
  if new.email is not null then
    select * into v_inv
      from public.equipo_invitaciones
     where lower(email)=lower(new.email) and estado='pending'
     order by creado
     limit 1
     for update;

    if found then
      insert into public.negocio_miembros(negocio_id,user_id,rol,activo)
      values(v_inv.negocio_id,new.id,v_inv.rol,true)
      on conflict (negocio_id,user_id)
      do update set rol=excluded.rol, activo=true;

      update public.equipo_invitaciones
         set estado='accepted', aceptado=now(), actualizado=now()
       where id=v_inv.id;

      insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
      values(v_inv.negocio_id,new.id,'invitacion_aceptada','equipo_invitaciones',v_inv.id,
             jsonb_build_object('email',lower(new.email),'rol',v_inv.rol));

      return new;
    end if;
  end if;

  if exists (select 1 from public.negocio_miembros where user_id=new.id) then return new; end if;

  v_nombre := nullif(trim(coalesce(new.raw_user_meta_data->>'business_name','')), '');
  if v_nombre is null then
    v_nombre := coalesce(nullif(split_part(coalesce(new.email,''),'@',1),''), 'Mi negocio');
  end if;

  insert into public.negocios(nombre,email,plan,activo)
  values(v_nombre,new.email,'starter',true)
  returning id into v_negocio_id;

  insert into public.negocio_miembros(negocio_id,user_id,rol,activo)
  values(v_negocio_id,new.id,'owner',true);

  insert into public.sucursales(negocio_id,nombre,activa)
  values(v_negocio_id,'Principal',true)
  returning id into v_sucursal_id;

  insert into public.cajas(negocio_id,sucursal_id,nombre,activa)
  values(v_negocio_id,v_sucursal_id,'Caja 1',true);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_vendify on auth.users;
create trigger on_auth_user_created_vendify
after insert on auth.users
for each row execute procedure public.crear_entorno_nuevo_usuario();

notify pgrst, 'reload schema';
commit;
