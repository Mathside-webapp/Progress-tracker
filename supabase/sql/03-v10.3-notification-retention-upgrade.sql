-- Mathside V10.3 - 7-day notification retention
-- Run this ONCE after the V10 classroom features upgrade.
-- No Edge Function is required.

begin;

create index if not exists mathside_notifications_created_at_idx
  on public.mathside_notifications(created_at);

-- Authenticated clients call this once per browser session.  It deletes only
-- notifications that are already older than the seven-day retention period.
create or replace function public.mathside_cleanup_old_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  delete from public.mathside_notifications
  where created_at < now() - interval '7 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mathside_cleanup_old_notifications() from public;
grant execute on function public.mathside_cleanup_old_notifications() to authenticated;

-- Database-side safety net: whenever Mathside creates a new notification,
-- expired notifications are also removed.  This keeps the table clean even
-- without relying only on the browser cleanup call.
create or replace function mathside_private.cleanup_expired_notifications_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.mathside_notifications
  where created_at < now() - interval '7 days';
  return null;
end;
$$;

drop trigger if exists mathside_notification_retention_cleanup
  on public.mathside_notifications;
create trigger mathside_notification_retention_cleanup
before insert on public.mathside_notifications
for each statement
execute function mathside_private.cleanup_expired_notifications_on_insert();

-- Clean any rows that are already expired when this upgrade is installed.
delete from public.mathside_notifications
where created_at < now() - interval '7 days';

commit;
