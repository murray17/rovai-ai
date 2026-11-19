ALTER TABLE camp ADD COLUMN archived_at TEXT;
ALTER TABLE camp ADD COLUMN archived_through_global_sequence INTEGER
    CHECK (archived_through_global_sequence IS NULL OR
        (typeof(archived_through_global_sequence) = 'integer' AND archived_through_global_sequence >= 0));
ALTER TABLE camp ADD COLUMN archive_revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(archive_revision) = 'integer' AND archive_revision >= 0
        AND (archived_at IS NULL) = (archived_through_global_sequence IS NULL)
        AND (archived_at IS NULL OR (activation_state = 'active' AND archive_revision > 0)));

CREATE INDEX camp_archive_list_idx ON camp (
    project_binding_kind, project_path, julianday(history_activity_at) DESC, id
) WHERE archived_at IS NOT NULL AND deletion_operation_id IS NULL;

-- Explicitly numbered events share the allocator's committed high-water mark.
UPDATE event_sequence SET last_sequence = MAX(last_sequence,
    COALESCE((SELECT MAX(global_sequence) FROM event_log), 0)) WHERE singleton = 1;
CREATE TRIGGER event_sequence_explicit_insert BEFORE INSERT ON event_log
WHEN NEW.global_sequence IS NOT NULL
BEGIN
    UPDATE event_sequence SET last_sequence = NEW.global_sequence
    WHERE singleton = 1 AND last_sequence < NEW.global_sequence;
END;
CREATE TRIGGER event_sequence_explicit_update BEFORE UPDATE OF global_sequence ON event_log
WHEN NEW.global_sequence IS NOT NULL
BEGIN
    UPDATE event_sequence SET last_sequence = NEW.global_sequence
    WHERE singleton = 1 AND last_sequence < NEW.global_sequence;
END;

-- A second event for the same message retains its original publication boundary.
CREATE TRIGGER camp_archive_publication_insert AFTER INSERT ON event_log
WHEN NEW.global_sequence IS NOT NULL AND NEW.entity_type = 'camp_message'
    AND NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
BEGIN
    UPDATE camp SET archived_at = NULL, archived_through_global_sequence = NULL,
        archive_revision = archive_revision + 1
    FROM camp_message AS message
    WHERE message.id = NEW.entity_id AND camp.id = message.camp_id
        AND camp.archived_at IS NOT NULL AND camp.deletion_operation_id IS NULL
        AND message.tombstoned_at IS NULL AND message.recall_state <> 'withdrawn'
        AND NEW.global_sequence > camp.archived_through_global_sequence
        AND NOT EXISTS(SELECT 1 FROM event_log
            WHERE entity_type = 'camp_message' AND entity_id = message.id
                AND event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                AND global_sequence < NEW.global_sequence);
END;

CREATE TRIGGER camp_archive_publication_sequence AFTER UPDATE OF global_sequence ON event_log
WHEN OLD.global_sequence IS NULL AND NEW.global_sequence IS NOT NULL
    AND NEW.entity_type = 'camp_message'
    AND NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
BEGIN
    UPDATE camp SET archived_at = NULL, archived_through_global_sequence = NULL,
        archive_revision = archive_revision + 1
    FROM camp_message AS message
    WHERE message.id = NEW.entity_id AND camp.id = message.camp_id
        AND camp.archived_at IS NOT NULL AND camp.deletion_operation_id IS NULL
        AND message.tombstoned_at IS NULL AND message.recall_state <> 'withdrawn'
        AND NEW.global_sequence > camp.archived_through_global_sequence
        AND NOT EXISTS(SELECT 1 FROM event_log
            WHERE entity_type = 'camp_message' AND entity_id = message.id
                AND event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                AND global_sequence < NEW.global_sequence);
END;
