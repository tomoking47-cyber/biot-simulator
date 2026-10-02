-- Costs, prices and dates in a request are for Japan only. The app no longer copies them into the snapshot that the
-- supplier reads; this trigger makes sure they can never be stored there, whatever writes the row.
create or replace function public.assignments_strip_japan_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.request_snapshot ? 'request' then
    new.request_snapshot := jsonb_set(new.request_snapshot, '{request}',
      (new.request_snapshot->'request') - 'costRaw' - 'costFin' - 'price' - 'date');
  end if;
  return new;
end $$;

drop trigger if exists assignments_strip_japan_only on public.assignments;
create trigger assignments_strip_japan_only before insert or update of request_snapshot on public.assignments
  for each row execute function public.assignments_strip_japan_only();

-- Requests already sent before this change.
update public.assignments set request_snapshot = jsonb_set(request_snapshot, '{request}',
  (request_snapshot->'request') - 'costRaw' - 'costFin' - 'price' - 'date')
where request_snapshot ? 'request';
