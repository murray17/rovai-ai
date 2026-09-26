-- v175: three per-Camp facts, maintained in the event writer's transaction.
-- No new table, change journal, group state, or retention policy.
ALTER TABLE camp ADD COLUMN navigation_activity_sequence INTEGER NOT NULL DEFAULT 0 CHECK(navigation_activity_sequence >= 0);
ALTER TABLE camp ADD COLUMN navigation_activity_at TEXT;
ALTER TABLE camp ADD COLUMN navigation_completion_sequence INTEGER NOT NULL DEFAULT 0 CHECK(navigation_completion_sequence >= 0);

WITH activity AS (
    SELECT e.camp_id,
        MAX(CASE WHEN e.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                      AND m.author_type IN ('user', 'external_principal') THEN e.global_sequence END) AS activity_sequence,
        MAX(CASE WHEN e.event_type IN ('agent_run.succeeded', 'agent_run.failed', 'agent_run.cancelled')
                      OR (e.event_type = 'camp_turn.status_changed' AND json_extract(e.payload_json, '$.status') = 'cancelled')
                 THEN e.global_sequence END) AS completion_sequence
    FROM event_log e
    LEFT JOIN camp_message m ON e.entity_type = 'camp_message' AND m.id = e.entity_id
    WHERE e.camp_id IS NOT NULL AND e.global_sequence IS NOT NULL
      AND e.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent',
                          'agent_run.succeeded', 'agent_run.failed', 'agent_run.cancelled', 'camp_turn.status_changed')
    GROUP BY e.camp_id
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
WHEN NEW.global_sequence IS NOT NULL AND NEW.camp_id IS NOT NULL
 AND (NEW.event_type IN ('agent_run.succeeded', 'agent_run.failed', 'agent_run.cancelled')
   OR (NEW.event_type = 'camp_turn.status_changed' AND json_extract(NEW.payload_json, '$.status') = 'cancelled')
   OR (NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent') AND NEW.entity_type = 'camp_message'
       AND EXISTS(SELECT 1 FROM camp_message WHERE id = NEW.entity_id AND author_type IN ('user', 'external_principal'))))
BEGIN
    UPDATE camp SET
        navigation_activity_at = CASE
            WHEN NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                 AND NEW.global_sequence > navigation_activity_sequence THEN NEW.created_at
            ELSE navigation_activity_at END,
        navigation_activity_sequence = CASE
            WHEN NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                THEN MAX(navigation_activity_sequence, NEW.global_sequence)
            ELSE navigation_activity_sequence END,
        navigation_completion_sequence = CASE
            WHEN NEW.event_type NOT IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                THEN MAX(navigation_completion_sequence, NEW.global_sequence)
            ELSE navigation_completion_sequence END
    WHERE id = NEW.camp_id;
END;

CREATE TRIGGER camp_navigation_event_sequence AFTER UPDATE OF global_sequence ON event_log
WHEN NEW.global_sequence IS NOT NULL AND NEW.camp_id IS NOT NULL
 AND (NEW.event_type IN ('agent_run.succeeded', 'agent_run.failed', 'agent_run.cancelled')
   OR (NEW.event_type = 'camp_turn.status_changed' AND json_extract(NEW.payload_json, '$.status') = 'cancelled')
   OR (NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent') AND NEW.entity_type = 'camp_message'
       AND EXISTS(SELECT 1 FROM camp_message WHERE id = NEW.entity_id AND author_type IN ('user', 'external_principal'))))
BEGIN
    UPDATE camp SET
        navigation_activity_at = CASE
            WHEN NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                 AND NEW.global_sequence > navigation_activity_sequence THEN NEW.created_at
            ELSE navigation_activity_at END,
        navigation_activity_sequence = CASE
            WHEN NEW.event_type IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                THEN MAX(navigation_activity_sequence, NEW.global_sequence)
            ELSE navigation_activity_sequence END,
        navigation_completion_sequence = CASE
            WHEN NEW.event_type NOT IN ('camp_message.sent', 'camp_message.public_a2a_sent')
                THEN MAX(navigation_completion_sequence, NEW.global_sequence)
            ELSE navigation_completion_sequence END
    WHERE id = NEW.camp_id;
END;
