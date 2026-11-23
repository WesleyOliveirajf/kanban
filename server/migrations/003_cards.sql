CREATE TABLE cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id),
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  description   text,
  status        text NOT NULL DEFAULT 'ideas' CHECK (status IN ('ideas','todo','doing','done')),
  position      integer NOT NULL CHECK (position >= 0),
  deadline      date,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_board_idx ON cards (project_id, status, position);
