-- Mathside V45: persist class artwork IDs in the existing sections table.
-- Run once in the existing Mathside Supabase project SQL Editor.
-- Does not change scores, rosters, archive state or existing RLS policies.
begin;
alter table public.mathside_sections
  add column if not exists theme_id text;
do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.mathside_sections'::regclass
      and conname = 'mathside_sections_theme_id_valid') then
    alter table public.mathside_sections add constraint mathside_sections_theme_id_valid
      check (theme_id is null or theme_id in ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15'));
  end if;
end $$;
comment on column public.mathside_sections.theme_id is 'Mathside class illustration identifier, shared across teacher devices. NULL means automatic/default artwork.';
commit;
notify pgrst, 'reload schema';
