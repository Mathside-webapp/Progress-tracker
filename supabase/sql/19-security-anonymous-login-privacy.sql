-- Mathside V24 - login-privacy hardening for EXISTING Supabase databases.
-- Safe to re-run; never changes accounts, passwords, usernames, or student records.
-- IMPORTANT: Run only AFTER checking that every current student auth email is
-- <username>@students.mathside.invalid (see SECURITY-GITHUB-PUBLISHING.md).
-- Only one-time manual execution is needed, not a recurring job.

begin;
create or replace function public.mathside_resolve_login(p_username text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9][a-z0-9._-]{1,78}$'
    then lower(btrim(p_username)) || '@students.mathside.invalid'
    else null
  end;
$$;

-- Existing clients that cache an older JS version can still sign in, but
-- cannot infer whether a student username really exists from this RPC.
revoke all on function public.mathside_resolve_login(text) from public;
grant execute on function public.mathside_resolve_login(text) to anon, authenticated;
commit;
