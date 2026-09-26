-- Test fixture only: Lark tables and neutral Lark rows must be empty.
DROP VIEW channel_member_bot_directory;

CREATE VIEW channel_member_bot_directory AS
            SELECT 'feishu' AS provider, agent_id, account_id, app_id,
                   app_id AS remote_app_id, NULL AS robot_code,
                   bot_display_name, credential_ref, status, failure_code,
                   version, 'open_id' AS owner_identity_kind
            FROM feishu_member_bot
            UNION ALL
            SELECT 'dingtalk' AS provider, agent_id, account_id, app_key AS app_id,
                   unified_app_id AS remote_app_id, robot_code,
                   bot_display_name, credential_ref, status, failure_code,
                   version, 'user_id' AS owner_identity_kind
            FROM dingtalk_member_bot;

DROP VIEW channel_owner_app_identity_directory;

CREATE VIEW channel_owner_app_identity_directory AS
            SELECT 'feishu' AS provider, app_id, account_id,
                   'open_id' AS identity_kind, open_id_digest AS identity_digest,
                   version, updated_at
            FROM feishu_owner_app_identity
            UNION ALL
            SELECT 'dingtalk' AS provider, app_key AS app_id, account_id,
                   'user_id' AS identity_kind, user_id_digest AS identity_digest,
                   version, updated_at
            FROM dingtalk_owner_app_identity;

DROP TABLE lark_member_bot_publication_intent;

DROP TABLE lark_member_bot;

DROP TABLE lark_owner_app_identity;

DROP TABLE lark_owner_identity;

DROP TABLE lark_account;

CREATE TABLE channel_credentials_v174 (
                credential_ref TEXT PRIMARY KEY NOT NULL
                    CHECK(length(trim(credential_ref)) > 0 AND length(credential_ref) <= 128),
                provider TEXT NOT NULL CHECK(provider IN ('feishu', 'dingtalk')),
                credential_kind TEXT NOT NULL CHECK(credential_kind = 'member_bot'),
                remote_app_id TEXT NOT NULL
                    CHECK(length(trim(remote_app_id)) > 0 AND length(remote_app_id) <= 512),
                payload_json TEXT NOT NULL
                    CHECK(length(payload_json) > 0 AND length(payload_json) <= 65536),
                schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
                revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(provider, credential_kind, remote_app_id)
            );

INSERT INTO channel_credentials_v174 SELECT * FROM channel_credentials;

DROP TABLE channel_credentials;

ALTER TABLE channel_credentials_v174 RENAME TO channel_credentials;

CREATE INDEX channel_credentials_provider_idx
                ON channel_credentials(provider);

CREATE INDEX channel_credentials_remote_app_idx
                ON channel_credentials(provider, remote_app_id);

CREATE TABLE channel_developer_sessions_v174 (
                provider TEXT PRIMARY KEY NOT NULL CHECK(provider IN ('feishu', 'dingtalk')),
                account_id TEXT NOT NULL
                    CHECK(length(trim(account_id)) > 0 AND length(account_id) <= 128),
                identity_json TEXT NOT NULL
                    CHECK(length(identity_json) > 0 AND length(identity_json) <= 65536),
                session_json TEXT NOT NULL
                    CHECK(length(session_json) > 0 AND length(session_json) <= 1048576),
                schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
                revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

INSERT INTO channel_developer_sessions_v174 SELECT * FROM channel_developer_sessions;

DROP TABLE channel_developer_sessions;

ALTER TABLE channel_developer_sessions_v174 RENAME TO channel_developer_sessions;

CREATE TABLE automation_notification_delivery_v174 (
                id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
                automation_run_id TEXT NOT NULL
                    REFERENCES automation_run(id) ON DELETE CASCADE,
                provider TEXT NOT NULL CHECK(provider IN ('feishu', 'dingtalk')),
                member_id TEXT NOT NULL CHECK(length(trim(member_id)) > 0),
                payload_json TEXT NOT NULL CHECK(
                    json_valid(payload_json)
                    AND json_type(payload_json) = 'object'
                ),
                status TEXT NOT NULL CHECK(status IN ('pending', 'attempting', 'sent', 'failed')),
                attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
                available_at TEXT NOT NULL,
                lease_owner TEXT,
                lease_expires_at TEXT,
                external_delivery_message_id TEXT,
                failure_code TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                ended_at TEXT,
                UNIQUE(automation_run_id, provider),
                CHECK(
                    (status = 'attempting' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
                    OR (status <> 'attempting' AND lease_owner IS NULL AND lease_expires_at IS NULL)
                ),
                CHECK(
                    (status IN ('pending', 'attempting') AND ended_at IS NULL)
                    OR (status IN ('sent', 'failed') AND ended_at IS NOT NULL)
                )
            );

INSERT INTO automation_notification_delivery_v174 SELECT * FROM automation_notification_delivery;

DROP TABLE automation_notification_delivery;

ALTER TABLE automation_notification_delivery_v174 RENAME TO automation_notification_delivery;

CREATE INDEX automation_notification_claim_idx
                ON automation_notification_delivery(provider, status, available_at, created_at, id)
                WHERE status IN ('pending', 'attempting');

DELETE FROM schema_migration WHERE version=175;
UPDATE rovai_data_contract SET contract_version='v1.70', projection_schema_version=124 WHERE singleton=1;
