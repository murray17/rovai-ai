CREATE TABLE chat_topic (
    conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    archived_at TEXT,
    last_activity_global_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_activity_global_sequence >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    deletion_operation_id TEXT
);
CREATE INDEX chat_topic_recent ON chat_topic(owner_user_id,last_activity_global_sequence DESC,conversation_id)
    WHERE archived_at IS NULL AND deletion_operation_id IS NULL;
CREATE INDEX conversation_agent_reply_sequence ON conversation_message(conversation_id,sequence DESC)
    WHERE author_type='agent';
CREATE TRIGGER chat_topic_kind_insert BEFORE INSERT ON chat_topic
WHEN NOT EXISTS(SELECT 1 FROM conversation
                 WHERE id=NEW.conversation_id AND kind='chat' AND camp_id IS NULL)
BEGIN SELECT RAISE(ABORT,'chat_topic requires an independent chat'); END;
CREATE TRIGGER chat_topic_identity_immutable BEFORE UPDATE OF conversation_id,owner_user_id ON chat_topic
WHEN NEW.conversation_id IS NOT OLD.conversation_id OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT,'chat topic identity is immutable'); END;
CREATE TRIGGER chat_conversation_identity_immutable BEFORE UPDATE OF id,kind,agent_id,camp_id ON conversation
WHEN (OLD.kind='chat' OR NEW.kind='chat') AND
     (NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.agent_id IS NOT OLD.agent_id OR NEW.camp_id IS NOT OLD.camp_id)
BEGIN SELECT RAISE(ABORT,'chat conversation identity is immutable'); END;
