-- ============================================================
--  Petition "Protegeons Nos Enfants" — schema PostgreSQL
--  Optionnel : la table se cree automatiquement au demarrage
--  du serveur. Ce fichier sert de reference.
-- ============================================================

CREATE TABLE IF NOT EXISTS signatures (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,          -- 'Citoyen Anonyme' si anonyme
  city        TEXT DEFAULT '',
  is_anon     BOOLEAN NOT NULL DEFAULT FALSE,
  ip          TEXT DEFAULT '',        -- pour la limite de 3 signatures / IP
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Si une ancienne table existe sans la colonne ip :
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS ip TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_signatures_created_at ON signatures (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signatures_ip ON signatures (ip);
