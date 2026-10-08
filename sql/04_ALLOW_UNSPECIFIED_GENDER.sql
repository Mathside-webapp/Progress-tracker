-- Applied to connected GradeDock Supabase. Only needed when setting up a different project.
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_gender_check;
ALTER TABLE public.students ADD CONSTRAINT students_gender_check CHECK (gender IN ('Male', 'Female', 'Unspecified'));
ALTER TABLE public.students ALTER COLUMN gender SET DEFAULT 'Unspecified';
