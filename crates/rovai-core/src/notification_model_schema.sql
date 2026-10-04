ALTER TABLE notification_preference ADD COLUMN single_chat_heads_up_enabled INTEGER NOT NULL DEFAULT 1 CHECK(single_chat_heads_up_enabled IN (0,1));
ALTER TABLE notification_preference ADD COLUMN mission_needs_you_heads_up_enabled INTEGER NOT NULL DEFAULT 1 CHECK(mission_needs_you_heads_up_enabled IN (0,1));
ALTER TABLE notification_preference ADD COLUMN mission_status_heads_up_enabled INTEGER NOT NULL DEFAULT 1 CHECK(mission_status_heads_up_enabled IN (0,1));
ALTER TABLE notification_preference ADD COLUMN task_status_heads_up_enabled INTEGER NOT NULL DEFAULT 0 CHECK(task_status_heads_up_enabled IN (0,1));
ALTER TABLE notification_preference ADD COLUMN mission_statuses_json TEXT NOT NULL DEFAULT '["completed"]' CHECK(json_valid(mission_statuses_json) AND json_type(mission_statuses_json)='array');
ALTER TABLE notification_preference ADD COLUMN task_statuses_json TEXT NOT NULL DEFAULT '["completed","blocked","cancelled"]' CHECK(json_valid(task_statuses_json) AND json_type(task_statuses_json)='array');

CREATE TABLE notification_round (
    id TEXT PRIMARY KEY,
    camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,
    last_agent_run_id TEXT NOT NULL,
    source_message_id TEXT,
    run_ids_json TEXT NOT NULL CHECK(json_valid(run_ids_json)),
    created_at TEXT NOT NULL
);
CREATE INDEX notification_round_camp ON notification_round(camp_id);
CREATE INDEX IF NOT EXISTS notification_message_source_run ON camp_message(source_agent_run_id);
CREATE INDEX IF NOT EXISTS notification_input_message ON agent_run_input(message_id,agent_run_id);
CREATE INDEX IF NOT EXISTS notification_delivery_run ON camp_message_delivery(claimed_agent_run_id,status);

-- An internal synchronous trigger entry point, empty at every commit. Both Run and
-- Delivery settlement enter here so no ordering of those writes can lose completion.
CREATE TABLE notification_round_probe (agent_run_id TEXT PRIMARY KEY);
CREATE TRIGGER notification_round_check AFTER INSERT ON notification_round_probe
BEGIN
    INSERT INTO notification_round(id,camp_id,last_agent_run_id,source_message_id,run_ids_json,created_at)
    SELECT root_id,camp_id,NEW.agent_run_id,source_message_id,run_ids_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM (
      WITH RECURSIVE component(kind,id) AS (
        SELECT 'run',NEW.agent_run_id
        UNION
        SELECT 'message',i.message_id FROM component c JOIN agent_run_input i ON c.kind='run' AND i.agent_run_id=c.id
        UNION
        SELECT 'run',i.agent_run_id FROM component c JOIN agent_run_input i ON c.kind='message' AND i.message_id=c.id
        UNION
        SELECT 'message',m.id FROM component c JOIN camp_message m ON c.kind='run' AND m.source_agent_run_id=c.id
          WHERE m.camp_id=(SELECT camp_id FROM agent_run WHERE id=NEW.agent_run_id)
        UNION
        SELECT 'run',m.source_agent_run_id FROM component c JOIN camp_message m ON c.kind='message' AND m.id=c.id
          JOIN agent_run r ON r.id=m.source_agent_run_id AND r.camp_id=m.camp_id AND r.invocation_kind='batch'
      ), messages AS (SELECT m.* FROM camp_message m JOIN component c ON c.kind='message' AND c.id=m.id),
      runs AS (SELECT r.* FROM agent_run r JOIN component c ON c.kind='run' AND c.id=r.id)
      SELECT (SELECT min(id) FROM messages WHERE author_type IN ('user','external_principal')) AS root_id,
        (SELECT camp_id FROM agent_run WHERE id=NEW.agent_run_id) AS camp_id,
        (SELECT id FROM messages WHERE author_type='agent' AND tombstoned_at IS NULL ORDER BY sequence DESC LIMIT 1) AS source_message_id,
        (SELECT json_group_array(id) FROM (SELECT id FROM runs ORDER BY id)) AS run_ids_json
      WHERE EXISTS(SELECT 1 FROM runs)
        AND NOT EXISTS(SELECT 1 FROM runs WHERE status<>'succeeded' OR invocation_kind<>'batch')
        AND NOT EXISTS(SELECT 1 FROM camp_message_delivery d JOIN messages m ON m.id=d.message_id WHERE d.status<>'settled')
        AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.tombstoned_at IS NOT NULL
          OR NOT EXISTS(SELECT 1 FROM event_log e WHERE e.entity_id=m.id AND e.entity_type='camp_message' AND e.event_type IN ('camp_message.sent','camp_message.public_a2a_sent')))
    ) WHERE root_id IS NOT NULL AND camp_id IS NOT NULL
    ON CONFLICT(id) DO NOTHING;
    DELETE FROM notification_round_probe WHERE agent_run_id=NEW.agent_run_id;
END;

CREATE TRIGGER notification_round_run_terminal AFTER UPDATE OF status ON agent_run
WHEN NEW.invocation_kind='batch' AND NEW.status='succeeded' AND OLD.status<>'succeeded'
BEGIN INSERT OR IGNORE INTO notification_round_probe VALUES(NEW.id); END;
CREATE TRIGGER notification_round_delivery_terminal AFTER UPDATE OF status ON camp_message_delivery
WHEN NEW.status='settled' AND OLD.status<>'settled' AND NEW.claimed_agent_run_id IS NOT NULL
BEGIN INSERT OR IGNORE INTO notification_round_probe VALUES(NEW.claimed_agent_run_id); END;
CREATE TRIGGER notification_round_publication AFTER INSERT ON event_log
WHEN NEW.entity_type='camp_message' AND NEW.event_type IN ('camp_message.sent','camp_message.public_a2a_sent')
BEGIN
    INSERT OR IGNORE INTO notification_round_probe
    SELECT source_agent_run_id FROM camp_message WHERE id=NEW.entity_id AND source_agent_run_id IS NOT NULL;
END;
