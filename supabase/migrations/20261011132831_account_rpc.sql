create function private.wire_row(value jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare k text; begin
  foreach k in array array['version','unit_price','quantity','extra_fee','total','budget_limit'] loop
    if value ? k then value := jsonb_set(value, array[k], to_jsonb(value ->> k)); end if;
  end loop;
  return value;
end $$;

create function private.initialize_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.request_user_id(); fresh boolean; begin
  if u is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  insert into public.user_settings(user_id) values (u) on conflict do nothing;
  fresh := found;
  if fresh then
    insert into public.categories(id,user_id,name,icon)
    select gen_random_uuid(), u, name, icon from (values
      ('Alimentation','shopping-basket'), ('Transport','bus'), ('Logement','house'),
      ('Santé','heart-pulse'), ('Loisirs','coffee'), ('Autres','ellipsis')
    ) defaults(name,icon);
  end if;
  return (select private.wire_row(to_jsonb(s)) from public.user_settings s where user_id = u);
end $$;

-- La comparaison porte sur le JSON canonique complet : pas de collision d'empreinte.
create function private.apply_change(
  p_operation_id uuid, p_entity text, p_entity_id uuid, p_kind text,
  p_base_version text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.request_user_id(); req jsonb; receipt public.sync_receipts%rowtype;
  current_row jsonb; result_row jsonb; result jsonb; expected bigint;
  allowed text[]; required text[]; field text; stamp timestamptz := clock_timestamp();
begin
  if u is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_operation_id is null or p_entity_id is null or p_entity is null
    or p_entity not in ('categories','expenses','monthly_budgets','user_settings')
    or p_kind is null or p_kind not in ('create','update','delete')
    or p_base_version is null or p_base_version !~ '^(0|[1-9][0-9]{0,18})$'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 8192 then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  expected := p_base_version::bigint;
  if (p_kind = 'create' and expected <> 0) or (p_kind <> 'create' and expected = 0)
    or (p_kind = 'delete' and p_entity <> 'expenses')
    or (p_entity = 'user_settings' and (p_kind <> 'update' or p_entity_id <> u)) then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  req := jsonb_build_object('entity',p_entity,'id',p_entity_id,'kind',p_kind,'base_version',p_base_version,'payload',p_payload);
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  select * into receipt from public.sync_receipts where user_id = u and operation_id = p_operation_id;
  if found then
    if receipt.request <> req then raise exception 'operation_id_reused' using errcode = '22023'; end if;
    return receipt.result;
  end if;
  case p_entity
    when 'categories' then
      select to_jsonb(c) into current_row from public.categories c where user_id = u and id = p_entity_id;
      allowed := array['name','icon','is_active']; required := array['name'];
    when 'expenses' then
      select to_jsonb(e) into current_row from public.expenses e where user_id = u and id = p_entity_id;
      allowed := array['expense_date','motif','category_id','unit_price','quantity','extra_fee']; required := allowed;
    when 'monthly_budgets' then
      select to_jsonb(b) into current_row from public.monthly_budgets b where user_id = u and id = p_entity_id;
      allowed := array['month_start','budget_limit','warning_thresholds']; required := allowed;
    when 'user_settings' then
      select to_jsonb(s) into current_row from public.user_settings s where user_id = u;
      allowed := array['currency','timezone','theme','locale']; required := allowed;
  end case;
  if (p_kind = 'create' and current_row is not null)
    or (p_kind <> 'create' and (current_row is null or (current_row->>'version')::bigint <> expected))
    or (p_entity = 'expenses' and current_row->>'deleted_at' is not null) then
    return jsonb_build_object('status','conflict','operation_id',p_operation_id,'remote',private.wire_row(current_row));
  end if;
  if p_kind = 'delete' then
    if p_payload <> '{}'::jsonb then raise exception 'invalid_payload' using errcode = '22023'; end if;
    update public.expenses set deleted_at = stamp, updated_at = stamp, version = version + 1
      where user_id = u and id = p_entity_id returning to_jsonb(expenses.*) into result_row;
  else
    if exists (select 1 from jsonb_object_keys(p_payload) k where not (k = any(allowed)))
      or not (p_payload ?& required) then raise exception 'invalid_payload' using errcode = '22023'; end if;
    foreach field in array allowed loop
      if field = 'icon' and p_payload->field = 'null'::jsonb then continue; end if;
      if field = 'warning_thresholds' then
        if jsonb_typeof(p_payload->field) is distinct from 'array' then raise exception 'invalid_thresholds' using errcode = '22023'; end if;
        if exists (select 1 from jsonb_array_elements(p_payload->field) n where jsonb_typeof(n) <> 'number' or n::text !~ '^[1-9][0-9]{0,2}$') then
          raise exception 'invalid_thresholds' using errcode = '22023';
        end if;
      elsif field = 'is_active' then
        if p_payload ? field and jsonb_typeof(p_payload->field) <> 'boolean' then raise exception 'invalid_payload' using errcode = '22023'; end if;
      elsif p_payload ? field and jsonb_typeof(p_payload->field) <> 'string' then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
    end loop;
    foreach field in array array['unit_price','extra_fee','budget_limit'] loop
      if p_payload ? field and (p_payload->>field) !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' then
        raise exception 'invalid_money' using errcode = '22023';
      end if;
    end loop;
    if p_payload ? 'quantity' and (p_payload->>'quantity') !~ '^(0|[1-9][0-9]{0,6})(\.[0-9]{1,3})?$' then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    foreach field in array array['expense_date','month_start'] loop
      if p_payload ? field and (p_payload->>field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'invalid_date' using errcode = '22023';
      end if;
    end loop;
    case p_entity
      when 'categories' then
        if p_kind = 'create' then
          insert into public.categories(id,user_id,name,icon,is_active) values
            (p_entity_id,u,btrim(p_payload->>'name'),p_payload->>'icon',coalesce((p_payload->>'is_active')::boolean,true))
            returning to_jsonb(categories.*) into result_row;
        else
          update public.categories set name=btrim(p_payload->>'name'), icon=p_payload->>'icon',
            is_active=coalesce((p_payload->>'is_active')::boolean,is_active), updated_at=stamp, version=version+1
            where user_id=u and id=p_entity_id returning to_jsonb(categories.*) into result_row;
        end if;
      when 'expenses' then
        if not exists (select 1 from public.categories where user_id=u and id=(p_payload->>'category_id')::uuid
          and (is_active or id=(current_row->>'category_id')::uuid)) then
          raise exception 'category_unavailable' using errcode = '22023';
        end if;
        if p_kind = 'create' then
          insert into public.expenses(id,user_id,expense_date,motif,category_id,unit_price,quantity,extra_fee) values
            (p_entity_id,u,(p_payload->>'expense_date')::date,btrim(p_payload->>'motif'),(p_payload->>'category_id')::uuid,
             (p_payload->>'unit_price')::numeric,(p_payload->>'quantity')::numeric,(p_payload->>'extra_fee')::numeric)
            returning to_jsonb(expenses.*) into result_row;
        else
          update public.expenses set expense_date=(p_payload->>'expense_date')::date,motif=btrim(p_payload->>'motif'),
            category_id=(p_payload->>'category_id')::uuid,unit_price=(p_payload->>'unit_price')::numeric,
            quantity=(p_payload->>'quantity')::numeric,extra_fee=(p_payload->>'extra_fee')::numeric,
            updated_at=stamp,version=version+1 where user_id=u and id=p_entity_id returning to_jsonb(expenses.*) into result_row;
        end if;
      when 'monthly_budgets' then
        if exists(select 1 from public.monthly_budgets where user_id=u and month_start=(p_payload->>'month_start')::date and id<>p_entity_id) then
          return jsonb_build_object('status','conflict','operation_id',p_operation_id,'reason','month_already_exists',
            'remote',(select private.wire_row(to_jsonb(b)) from public.monthly_budgets b where user_id=u and month_start=(p_payload->>'month_start')::date));
        end if;
        if p_kind='create' then
          insert into public.monthly_budgets(id,user_id,month_start,budget_limit,warning_thresholds) values
            (p_entity_id,u,(p_payload->>'month_start')::date,(p_payload->>'budget_limit')::numeric,
             array(select n::integer from jsonb_array_elements_text(p_payload->'warning_thresholds') n)) returning to_jsonb(monthly_budgets.*) into result_row;
        else
          update public.monthly_budgets set month_start=(p_payload->>'month_start')::date,budget_limit=(p_payload->>'budget_limit')::numeric,
            warning_thresholds=array(select n::integer from jsonb_array_elements_text(p_payload->'warning_thresholds') n),updated_at=stamp,version=version+1
            where user_id=u and id=p_entity_id returning to_jsonb(monthly_budgets.*) into result_row;
        end if;
      when 'user_settings' then
        if p_payload->>'currency' <> current_row->>'currency' and exists(select 1 from public.expenses where user_id=u) then
          raise exception 'currency_has_history' using errcode = '22023';
        end if;
        if not exists(select 1 from pg_timezone_names where name=p_payload->>'timezone') then
          raise exception 'invalid_timezone' using errcode = '22023';
        end if;
        update public.user_settings set currency=p_payload->>'currency',timezone=p_payload->>'timezone',theme=p_payload->>'theme',locale=p_payload->>'locale',
          updated_at=stamp,version=version+1 where user_id=u returning to_jsonb(user_settings.*) into result_row;
    end case;
  end if;
  result := jsonb_build_object('status','applied','operation_id',p_operation_id,'row',private.wire_row(result_row));
  insert into public.sync_receipts(user_id,operation_id,request,result) values(u,p_operation_id,req,result);
  return result;
end $$;

create function public.initialize_account() returns jsonb language sql security invoker set search_path = ''
as $$ select private.initialize_account() $$;
create function public.apply_change(p_operation_id uuid,p_entity text,p_entity_id uuid,p_kind text,p_base_version text,p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.apply_change(p_operation_id,p_entity,p_entity_id,p_kind,p_base_version,p_payload) $$;

create function public.read_account_page(p_entity text,p_after uuid default null,p_limit integer default 100)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare rows jsonb; begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'invalid_limit' using errcode = '22023'; end if;
  case p_entity
    when 'categories' then select coalesce(jsonb_agg(private.wire_row(to_jsonb(r)) order by r.id),'[]') into rows from
      (select * from public.categories where user_id=auth.uid() and (p_after is null or id>p_after) order by id limit p_limit) r;
    when 'expenses' then select coalesce(jsonb_agg(private.wire_row(to_jsonb(r)) order by r.id),'[]') into rows from
      (select * from public.expenses where user_id=auth.uid() and (p_after is null or id>p_after) order by id limit p_limit) r;
    when 'monthly_budgets' then select coalesce(jsonb_agg(private.wire_row(to_jsonb(r)) order by r.id),'[]') into rows from
      (select * from public.monthly_budgets where user_id=auth.uid() and (p_after is null or id>p_after) order by id limit p_limit) r;
    when 'user_settings' then select coalesce(jsonb_agg(private.wire_row(to_jsonb(r))),'[]') into rows from
      (select * from public.user_settings where user_id=auth.uid() and (p_after is null or user_id>p_after)) r;
    else raise exception 'invalid_entity' using errcode = '22023';
  end case;
  return rows;
end $$;

grant create on schema private to ny_volako_writer;
alter function private.initialize_account() owner to ny_volako_writer;
alter function private.apply_change(uuid,text,uuid,text,text,jsonb) owner to ny_volako_writer;
revoke create on schema private from ny_volako_writer;
revoke all on all functions in schema private from public, anon;
grant execute on function private.wire_row(jsonb) to authenticated, ny_volako_writer;
grant execute on function private.initialize_account(), private.apply_change(uuid,text,uuid,text,text,jsonb) to authenticated;
revoke all on function public.initialize_account(), public.apply_change(uuid,text,uuid,text,text,jsonb), public.read_account_page(text,uuid,integer) from public, anon;
grant execute on function public.initialize_account(), public.apply_change(uuid,text,uuid,text,text,jsonb), public.read_account_page(text,uuid,integer) to authenticated;
