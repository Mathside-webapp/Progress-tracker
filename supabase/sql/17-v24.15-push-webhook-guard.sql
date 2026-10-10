-- Mathside V24.15: only invoke the existing push webhook for an account
-- that has at least one registered push device. In-app notification rows
-- and their 7-day retention continue to work for EVERY account.
-- Safe to re-run. Preserves the existing webhook URL and authentication
-- headers in Supabase without copying keys into this SQL file.

begin;

create or replace function mathside_private.push_subscription_exists(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $mathside$
  select exists (
    select 1 from public.mathside_push_subscriptions
    where user_id = p_user_id
  );
$mathside$;

revoke all on function mathside_private.push_subscription_exists(uuid) from public, anon;
grant execute on function mathside_private.push_subscription_exists(uuid)
  to authenticated, service_role, postgres;

do $migration$
declare
  old_definition text;
  new_definition text;
begin
  select pg_get_triggerdef(t.oid)
  into old_definition
  from pg_trigger t
  where t.tgrelid = 'public.mathside_notifications'::regclass
    and t.tgname = 'mathside-push-notifications'
    and not t.tgisinternal;

  if old_definition is null then
    raise exception 'Existing push webhook not found. Configure the webhook before applying this guard.';
  end if;

  if position('mathside_private.push_subscription_exists' in old_definition) > 0 then
    return;
  end if;

  new_definition := replace(
    old_definition,
    'FOR EACH ROW EXECUTE FUNCTION',
    'FOR EACH ROW WHEN (mathside_private.push_subscription_exists(NEW.user_id)) EXECUTE FUNCTION'
  );

  if new_definition = old_definition then
    raise exception 'Unexpected webhook trigger format. Existing webhook left untouched.';
  end if;

  execute 'DROP TRIGGER "mathside-push-notifications" ON public.mathside_notifications';
  execute new_definition;
end
$migration$;

commit;
