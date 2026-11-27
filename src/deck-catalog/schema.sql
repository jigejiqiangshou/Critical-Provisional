CREATE TABLE releases (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  rules_version TEXT NOT NULL CHECK (length(trim(rules_version)) > 0),
  sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1))
) STRICT;

CREATE TABLE card_identities (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0)
) STRICT;

CREATE TABLE release_cards (
  release_id TEXT NOT NULL REFERENCES releases(id),
  id TEXT NOT NULL REFERENCES card_identities(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('unit', 'spell', 'trap', 'ace')),
  flagship INTEGER NOT NULL CHECK (flagship IN (0, 1) AND (flagship = 0 OR kind = 'unit')),
  data TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
  PRIMARY KEY (release_id, id)
) STRICT;

CREATE TABLE release_presets (
  release_id TEXT NOT NULL REFERENCES releases(id),
  id TEXT NOT NULL CHECK (length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  PRIMARY KEY (release_id, id)
) STRICT;

CREATE TABLE release_preset_entries (
  release_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (release_id, preset_id, position),
  FOREIGN KEY (release_id, preset_id) REFERENCES release_presets(release_id, id),
  FOREIGN KEY (release_id, card_id) REFERENCES release_cards(release_id, id)
) STRICT;

CREATE TRIGGER immutable_card_identity_update BEFORE UPDATE ON card_identities
BEGIN SELECT RAISE(ABORT, 'Card ID is permanent'); END;

CREATE TRIGGER immutable_card_identity_delete BEFORE DELETE ON card_identities
BEGIN SELECT RAISE(ABORT, 'Card ID is permanent'); END;

CREATE TRIGGER release_insert_unsealed BEFORE INSERT ON releases
WHEN NEW.sealed <> 0 OR EXISTS (SELECT 1 FROM releases WHERE id = NEW.id AND sealed = 1)
BEGIN SELECT RAISE(ABORT, 'Only a new unsealed release can be inserted'); END;

CREATE TRIGGER release_seal_once BEFORE UPDATE ON releases
WHEN OLD.sealed <> 0 OR NEW.sealed <> 1 OR OLD.id <> NEW.id OR OLD.rules_version <> NEW.rules_version
     OR NOT EXISTS (SELECT 1 FROM release_cards WHERE release_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'A release may only be sealed after its cards are written'); END;

CREATE TRIGGER immutable_release_delete BEFORE DELETE ON releases
WHEN OLD.sealed = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_card_insert BEFORE INSERT ON release_cards
WHEN (SELECT sealed FROM releases WHERE id = NEW.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_card_update BEFORE UPDATE ON release_cards
WHEN (SELECT sealed FROM releases WHERE id = OLD.release_id) = 1
  OR (SELECT sealed FROM releases WHERE id = NEW.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_card_delete BEFORE DELETE ON release_cards
WHEN (SELECT sealed FROM releases WHERE id = OLD.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_preset_insert BEFORE INSERT ON release_presets
WHEN (SELECT sealed FROM releases WHERE id = NEW.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_preset_update BEFORE UPDATE ON release_presets
WHEN (SELECT sealed FROM releases WHERE id = OLD.release_id) = 1
  OR (SELECT sealed FROM releases WHERE id = NEW.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_preset_delete BEFORE DELETE ON release_presets
WHEN (SELECT sealed FROM releases WHERE id = OLD.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_entry_insert BEFORE INSERT ON release_preset_entries
WHEN (SELECT sealed FROM releases WHERE id = NEW.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_entry_update BEFORE UPDATE ON release_preset_entries
WHEN (SELECT sealed FROM releases WHERE id = OLD.release_id) = 1
  OR (SELECT sealed FROM releases WHERE id = NEW.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;

CREATE TRIGGER immutable_release_entry_delete BEFORE DELETE ON release_preset_entries
WHEN (SELECT sealed FROM releases WHERE id = OLD.release_id) = 1
BEGIN SELECT RAISE(ABORT, 'Sealed release is immutable'); END;
