-- Fecha a API REST pública do Supabase (anon/authenticated). O app acessa o banco
-- só por DATABASE_URL (papel postgres, que ignora RLS). Idempotente.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
