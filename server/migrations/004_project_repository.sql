ALTER TABLE projects ADD COLUMN repository_url text CHECK (repository_url IS NULL OR length(repository_url) <= 500);
