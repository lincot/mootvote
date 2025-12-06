CREATE TABLE censuses (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  creator_x    BYTEA NOT NULL CHECK (octet_length(creator_x)=32),
  creator_y    BYTEA NOT NULL CHECK (octet_length(creator_y)=32),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE census_members (
  id        BIGSERIAL PRIMARY KEY,
  census_id BIGINT NOT NULL REFERENCES censuses(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  pub_x     BYTEA CHECK (pub_x IS NULL OR octet_length(pub_x)=32),
  pub_y     BYTEA CHECK (pub_y IS NULL OR octet_length(pub_y)=32),
  invite    BYTEA UNIQUE CHECK (invite IS NULL OR octet_length(invite)=32)
);

CREATE UNIQUE INDEX uq_census_key
  ON census_members(census_id, pub_x, pub_y)
  WHERE pub_x IS NOT NULL AND pub_y IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_census_members_list
  ON census_members(census_id, id);
