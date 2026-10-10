-- Mathside V24.14 — class logo/background customization
-- Safe to run more than once.
alter table public.mathside_sections
  add column if not exists logo_key text not null default 'logo-01',
  add column if not exists background_key text not null default 'bg-01';

-- Optional starter mapping for the sample/current class names.
update public.mathside_sections set logo_key='logo-01', background_key='bg-01' where lower(name) like '%beryl%';
update public.mathside_sections set logo_key='logo-02', background_key='bg-02' where lower(name) like '%cobalt%';
update public.mathside_sections set logo_key='logo-04', background_key='bg-03' where lower(name) like '%jade%';
update public.mathside_sections set logo_key='logo-03', background_key='bg-04' where lower(name) like '%pearl%';
