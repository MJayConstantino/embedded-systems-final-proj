-- Bootstrap schema. Apply through the generated migration; do not put device secrets in SQL.
create table public.devices (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null default 'Plant station 01', session_id text, last_seen timestamptz,
  created_at timestamptz not null default now()
);
create table public.device_credentials (device_id uuid primary key references public.devices(id) on delete cascade, secret_hash text not null check(length(secret_hash)=64));
create table public.device_sessions (device_id uuid references public.devices(id) on delete cascade, session_id text not null, primary key(device_id,session_id));
create table public.latest_telemetry (device_id uuid primary key references public.devices(id) on delete cascade, payload jsonb not null, received_at timestamptz not null default now());
create table public.history (device_id uuid references public.devices(id) on delete cascade, recorded_at timestamptz not null, sensors jsonb not null, primary key(device_id,recorded_at));
create table public.commands (
  id uuid primary key default gen_random_uuid(), revision bigint generated always as identity,
  device_id uuid not null references public.devices(id) on delete cascade, session_id text not null,
  actuator text not null check(actuator in ('fan','pump','atomizer')), mode text not null check(mode in ('auto','manual')),
  "on" boolean not null, duration_ms integer not null,
  status text not null default 'pending' check(status in ('pending','applied','rejected','expired')),
  reason text, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 seconds', delivered_at timestamptz,
  check ((mode='auto' and not "on" and duration_ms=0) or (mode='manual' and (("on" and duration_ms in (30000,60000,300000)) or (not "on" and duration_ms=0))))
);
create unique index one_pending_per_actuator on public.commands(device_id,actuator) where status='pending';
create index commands_device_created on public.commands(device_id,created_at desc);
create table public.control_events (id bigint generated always as identity primary key, device_id uuid not null references public.devices(id) on delete cascade, kind text not null, message text not null, created_at timestamptz not null default now());
create index events_device_created on public.control_events(device_id,created_at desc);

alter table public.devices enable row level security;
alter table public.device_credentials enable row level security;
alter table public.device_sessions enable row level security;
alter table public.latest_telemetry enable row level security;
alter table public.history enable row level security;
alter table public.commands enable row level security;
alter table public.control_events enable row level security;
revoke all on public.devices,public.device_credentials,public.device_sessions,public.latest_telemetry,public.history,public.commands,public.control_events from anon,authenticated;
grant select on public.devices,public.latest_telemetry,public.history,public.commands,public.control_events to authenticated;
grant all on public.devices,public.device_credentials,public.device_sessions,public.latest_telemetry,public.history,public.commands,public.control_events to service_role;
grant usage,select on all sequences in schema public to service_role;
create policy own_device on public.devices for select to authenticated using(owner_id=(select auth.uid()));
create policy own_latest on public.latest_telemetry for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));
create policy own_history on public.history for select to authenticated using(recorded_at>=now()-interval '24 hours' and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));
create policy own_commands on public.commands for select to authenticated using(created_at>=now()-interval '24 hours' and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));
create policy own_events on public.control_events for select to authenticated using(created_at>=now()-interval '24 hours' and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

-- These transactional RPCs use invoker permissions and are callable only by the backend service role.
create function public.issue_command(p_owner uuid,p_device uuid,p_actuator text,p_mode text,p_on boolean,p_duration integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.devices; result public.commands;
begin
  select * into d from public.devices where id=p_device for update;
  if d.id is null or d.owner_id is distinct from p_owner then raise exception 'Device access denied'; end if;
  if d.last_seen is null or d.last_seen<now()-interval '30 seconds' or d.session_id is null then raise exception 'Device readings are stale'; end if;
  update public.commands set status='expired',reason='Superseded by a newer request' where device_id=p_device and actuator=p_actuator and status='pending';
  insert into public.commands(device_id,session_id,actuator,mode,"on",duration_ms) values(p_device,d.session_id,p_actuator,p_mode,p_on,p_duration) returning * into result;
  insert into public.control_events(device_id,kind,message) values(p_device,'pending',p_actuator||' · requested '||case when p_mode='auto' then 'Auto' when p_on then 'Manual ON' else 'Manual OFF' end);
  return to_jsonb(result);
end $$;

create function public.exchange_device(p_device uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.devices; previous public.latest_telemetry; ack jsonb; c public.commands; a text;
  sid text:=p_payload->>'session_id'; seq bigint:=(p_payload->>'sample_seq')::bigint; packet jsonb;
begin
  select * into d from public.devices where id=p_device for update;
  if d.id is null or p_payload->>'device_id'<>p_device::text then raise exception 'Unknown device'; end if;
  select * into previous from public.latest_telemetry where device_id=p_device;
  if d.session_id is distinct from sid then
    if exists(select 1 from public.device_sessions where device_id=p_device and session_id=sid) then raise exception 'Retired board session'; end if;
    insert into public.device_sessions values(p_device,sid);
    update public.commands set status='expired',reason='Board restarted' where device_id=p_device and status='pending';
    insert into public.control_events(device_id,kind,message) values(p_device,'connected','Device connected · new board session');
  elsif previous.device_id is not null and seq<(previous.payload->>'sample_seq')::bigint then
    raise exception 'Out-of-order sensor packet';
  end if;
  -- Only a genuinely new sensor sample advances the freshness timestamp.
  if d.session_id is distinct from sid or previous.device_id is null or seq>(previous.payload->>'sample_seq')::bigint then
    update public.devices set session_id=sid,last_seen=now() where id=p_device;
    packet:=p_payload-'acks';
    insert into public.latest_telemetry values(p_device,packet,now()) on conflict(device_id) do update set payload=excluded.payload,received_at=excluded.received_at;
    insert into public.history values(p_device,date_trunc('minute',now()),p_payload->'sensors') on conflict do nothing;
    if d.session_id=sid and previous.device_id is not null then
      foreach a in array array['fan','pump','atomizer'] loop
        if previous.payload->'actuators'->a is distinct from packet->'actuators'->a and (
          previous.payload->'actuators'->a->'on' is distinct from packet->'actuators'->a->'on' or
          previous.payload->'actuators'->a->'mode' is distinct from packet->'actuators'->a->'mode' or
          previous.payload->'actuators'->a->'blocked' is distinct from packet->'actuators'->a->'blocked') then
          insert into public.control_events(device_id,kind,message) values(p_device,'output',a||' · '||case when (packet->'actuators'->a->>'on')::boolean then 'ON' else 'OFF' end||' · '||(packet->'actuators'->a->>'mode')||coalesce(' · '||(packet->'actuators'->a->>'blocked'),''));
        end if;
      end loop;
    end if;
  end if;
  for ack in select * from jsonb_array_elements(coalesce(p_payload->'acks','[]'::jsonb)) loop
    update public.commands set status=ack->>'status',reason=ack->>'reason'
      where id=(ack->>'id')::uuid and device_id=p_device and session_id=sid and status='pending' and delivered_at is not null returning * into c;
    if found then insert into public.control_events(device_id,kind,message) values(p_device,c.status,c.actuator||' · command '||c.status||coalesce(' · '||c.reason,'')); end if;
  end loop;
  update public.commands set status='expired',reason='Delivery window elapsed' where device_id=p_device and status='pending' and expires_at<=now() and delivered_at is null;
  update public.commands set status='expired',reason='Acknowledgement timed out; consult reported output' where device_id=p_device and status='pending' and delivered_at<now()-interval '45 seconds';
  -- Stop resending after expiry; late acknowledgements still resolve previously delivered commands.
  update public.commands set delivered_at=coalesce(delivered_at,now()) where device_id=p_device and session_id=sid and status='pending' and expires_at>now();
  return jsonb_build_object('commands',coalesce((select jsonb_agg(jsonb_build_object('id',id,'device_id',device_id,'session_id',session_id,'revision',revision,'actuator',actuator,'mode',mode,'on',"on",'duration_ms',duration_ms,'expires_at',expires_at,'ttl_ms',floor(extract(epoch from (expires_at-now()))*1000))) from public.commands where device_id=p_device and session_id=sid and status='pending' and expires_at>now()),'[]'::jsonb));
end $$;

create function public.prune_plant_history() returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  delete from public.history where recorded_at<now()-interval '24 hours';
  delete from public.control_events where created_at<now()-interval '24 hours';
  delete from public.commands where created_at<now()-interval '24 hours';
end $$;
revoke all on function public.issue_command(uuid,uuid,text,text,boolean,integer),public.exchange_device(uuid,jsonb),public.prune_plant_history() from public,anon,authenticated;
grant execute on function public.issue_command(uuid,uuid,text,text,boolean,integer),public.exchange_device(uuid,jsonb),public.prune_plant_history() to service_role;
