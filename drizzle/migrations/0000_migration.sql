CREATE TABLE public.map_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'draft',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.map_documents TO anon, authenticated;
GRANT ALL ON public.map_documents TO service_role;
ALTER TABLE public.map_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.map_documents FOR SELECT USING (true);
CREATE POLICY "public insert" ON public.map_documents FOR INSERT WITH CHECK (kind IN ('draft','published'));
CREATE POLICY "public update draft" ON public.map_documents FOR UPDATE USING (kind = 'draft') WITH CHECK (kind = 'draft');