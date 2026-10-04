-- v177: three per-Camp facts, maintained in the event writer's transaction.
-- No new table, change journal, group state, or retention policy.
ALTER TABLE camp ADD COLUMN navigation_activity_sequence INTEGER NOT NULL DEFAULT 0 CHECK(navigation_activity_sequence >= 0);
ALTER TABLE camp ADD COLUMN navigation_activity_at TEXT;
ALTER TABLE camp ADD COLUMN navigation_completion_sequence INTEGER NOT NULL DEFAULT 0 CHECK(navigation_completion_sequence >= 0);

WITH publication AS (
    SELECT entity_id AS message_id, MIN(global_sequence) AS global_sequence
    FROM event_log
    WHERE entity_type = 'camp_message'
      AND event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
      AND entity_id IS NOT NULL AND global_sequence IS NOT NULL
    GROUP BY entity_id
), activity AS (
    SELECT m.camp_id,
        MAX(CASE WHEN m.author_type IN ('user', 'external_principal') THEN publication.global_sequence END) AS activity_sequence,
        MAX(CASE WHEN m.author_type = 'agent' AND m.tombstoned_at IS NULL THEN publication.global_sequence END) AS completion_sequence
    FROM camp_message m JOIN publication ON publication.message_id = m.id
    GROUP BY m.camp_id
)
UPDATE camp SET
    navigation_activity_sequence = COALESCE(activity.activity_sequence, 0),
    navigation_activity_at = (SELECT created_at FROM event_log WHERE global_sequence = activity.activity_sequence),
    navigation_completion_sequence = COALESCE(activity.completion_sequence, 0)
FROM activity WHERE camp.id = activity.camp_id;

CREATE INDEX camp_navigation_window_idx ON camp (
    CASE WHEN project_binding_kind = 'directory' THEN 'directory:' || project_path ELSE 'quick-chat' END,
    COALESCE(navigation_activity_at, created_at) DESC,
    navigation_activity_sequence DESC, id
) WHERE deletion_operation_id IS NULL;
CREATE INDEX agent_run_navigation_active_idx ON agent_run(camp_id)
    WHERE status IN ('queued', 'running', 'waiting');
CREATE INDEX agent_run_navigation_legacy_active_idx ON agent_run(camp_turn_id)
    WHERE camp_id IS NULL AND status IN ('queued', 'running', 'waiting');

-- The sequence allocator updates auto-numbered events; explicit sequences use INSERT.
CREATE TRIGGER camp_navigation_event_insert AFTER INSERT ON event_log
WHEN NEW.global_sequence IS NOT NULL AND NEW.entity_type = 'camp_message'
 AND NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
 AND EXISTS(SELECT 1 FROM camp_message WHERE id = NEW.entity_id
            AND (author_type IN ('user', 'external_principal') OR (author_type = 'agent' AND tombstoned_at IS NULL)))
 AND NOT EXISTS(SELECT 1 FROM event_log WHERE entity_type = 'camp_message' AND entity_id = NEW.entity_id
                AND event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                AND global_sequence < NEW.global_sequence)
BEGIN
    UPDATE camp SET
        navigation_activity_at = CASE
            WHEN (SELECT author_type FROM camp_message WHERE id = NEW.entity_id) IN ('user', 'external_principal')
                 AND NEW.global_sequence > navigation_activity_sequence THEN NEW.created_at
            ELSE navigation_activity_at END,
        navigation_activity_sequence = CASE
            WHEN (SELECT author_type FROM camp_message WHERE id = NEW.entity_id) IN ('user', 'external_principal')
                THEN MAX(navigation_activity_sequence, NEW.global_sequence)
            ELSE navigation_activity_sequence END,
        navigation_completion_sequence = CASE
            WHEN (SELECT author_type FROM camp_message WHERE id = NEW.entity_id) = 'agent'
                THEN MAX(navigation_completion_sequence, NEW.global_sequence)
            ELSE navigation_completion_sequence END
    WHERE id = (SELECT camp_id FROM camp_message WHERE id = NEW.entity_id);
END;

CREATE TRIGGER camp_navigation_event_sequence AFTER UPDATE OF global_sequence ON event_log
WHEN NEW.global_sequence IS NOT NULL AND NEW.entity_type = 'camp_message'
 AND NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
 AND EXISTS(SELECT 1 FROM camp_message WHERE id = NEW.entity_id
            AND (author_type IN ('user', 'external_principal') OR (author_type = 'agent' AND tombstoned_at IS NULL)))
 AND NOT EXISTS(SELECT 1 FROM event_log WHERE entity_type = 'camp_message' AND entity_id = NEW.entity_id
                AND event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                AND global_sequence < NEW.global_sequence)
BEGIN
    UPDATE camp SET
        navigation_activity_at = CASE
            WHEN (SELECT author_type FROM camp_message WHERE id = NEW.entity_id) IN ('user', 'external_principal')
                 AND NEW.global_sequence > navigation_activity_sequence THEN NEW.created_at
            ELSE navigation_activity_at END,
        navigation_activity_sequence = CASE
            WHEN (SELECT author_type FROM camp_message WHERE id = NEW.entity_id) IN ('user', 'external_principal')
                THEN MAX(navigation_activity_sequence, NEW.global_sequence)
            ELSE navigation_activity_sequence END,
        navigation_completion_sequence = CASE
            WHEN (SELECT author_type FROM camp_message WHERE id = NEW.entity_id) = 'agent'
                THEN MAX(navigation_completion_sequence, NEW.global_sequence)
            ELSE navigation_completion_sequence END
    WHERE id = (SELECT camp_id FROM camp_message WHERE id = NEW.entity_id);
END;

CREATE TRIGGER camp_navigation_reply_tombstone AFTER UPDATE OF tombstoned_at ON camp_message
WHEN NEW.author_type = 'agent' AND OLD.tombstoned_at IS NOT NEW.tombstoned_at
BEGIN
    UPDATE camp SET navigation_completion_sequence = COALESCE((
        SELECT MAX(first_publication) FROM (
            SELECT MIN(e.global_sequence) AS first_publication
            FROM camp_message m JOIN event_log e ON e.entity_type = 'camp_message' AND e.entity_id = m.id
            WHERE m.camp_id = NEW.camp_id AND m.author_type = 'agent' AND m.tombstoned_at IS NULL
              AND e.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
              AND e.global_sequence IS NOT NULL
            GROUP BY m.id
        )
    ), 0) WHERE id = NEW.camp_id;
END;
