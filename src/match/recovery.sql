CREATE TABLE matches (
  session_id TEXT PRIMARY KEY NOT NULL CHECK (length(session_id) > 0),
  version_hash TEXT NOT NULL CHECK (length(version_hash) = 64 AND version_hash NOT GLOB '*[^0-9a-f]*'),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  outcome TEXT CHECK (outcome IS NULL OR json_valid(outcome)),
  UNIQUE (session_id, version_hash),
  FOREIGN KEY (session_id, version_hash, current_revision)
    REFERENCES confirmations (session_id, version_hash, revision) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE confirmations (
  session_id TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  summary_through INTEGER NOT NULL CHECK (summary_through >= 0),
  action TEXT CHECK (action IS NULL OR json_valid(action)),
  history TEXT CHECK (history IS NULL OR json_valid(history)),
  PRIMARY KEY (session_id, revision),
  UNIQUE (session_id, version_hash, revision),
  CHECK ((revision = 0 AND action IS NULL AND summary_through = 0)
    OR (revision > 0 AND action IS NOT NULL AND summary_through > 0)),
  FOREIGN KEY (session_id, version_hash) REFERENCES matches (session_id, version_hash)
) STRICT;

CREATE TABLE commands (
  session_id TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  seat_id TEXT NOT NULL CHECK (length(seat_id) > 0),
  command_id TEXT NOT NULL CHECK (length(command_id) > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  confirmation_revision INTEGER CHECK (confirmation_revision > 0),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  PRIMARY KEY (session_id, seat_id, command_id),
  UNIQUE (session_id, ordinal),
  UNIQUE (session_id, confirmation_revision),
  CHECK ((confirmation_revision IS NULL) = (result IS NULL)),
  FOREIGN KEY (session_id, version_hash) REFERENCES matches (session_id, version_hash),
  FOREIGN KEY (session_id, version_hash, confirmation_revision)
    REFERENCES confirmations (session_id, version_hash, revision) DEFERRABLE INITIALLY DEFERRED
) STRICT;
