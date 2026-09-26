-- Lark owns a separate table family; existing Feishu rows are never copied.

CREATE TABLE lark_account (
                    id TEXT PRIMARY KEY,
                    identity_digest TEXT NOT NULL CHECK(length(identity_digest) > 0),
                    display_name TEXT NOT NULL CHECK(length(trim(display_name)) > 0),
                    tenant_name TEXT NOT NULL CHECK(length(trim(tenant_name)) > 0),
                    status TEXT NOT NULL CHECK(status IN ('connected', 'disconnected', 'session_expired')),
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    disconnected_at TEXT
                , user_id_digest TEXT, tenant_id TEXT, user_name TEXT, email TEXT, brand TEXT NOT NULL CHECK(brand = 'lark'), connected_at TEXT, last_verified_at TEXT);

CREATE TABLE lark_owner_identity (
                    account_id TEXT PRIMARY KEY REFERENCES lark_account(id) ON DELETE CASCADE,
                    tenant_id TEXT NOT NULL CHECK(length(trim(tenant_id)) > 0),
                    canonical_owner_principal_id TEXT NOT NULL UNIQUE,
                    user_id_digest TEXT NOT NULL CHECK(length(trim(user_id_digest)) > 0),
                    union_id_digest TEXT,
                    verified_at TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

CREATE TABLE lark_owner_app_identity (
                    account_id TEXT NOT NULL
                        REFERENCES lark_owner_identity(account_id) ON DELETE CASCADE,
                    app_id TEXT NOT NULL CHECK(length(trim(app_id)) > 0),
                    open_id_digest TEXT,
                    user_id_digest TEXT,
                    union_id_digest TEXT,
                    verified_at TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(account_id, app_id),
                    CHECK(
                        open_id_digest IS NOT NULL
                        OR user_id_digest IS NOT NULL
                        OR union_id_digest IS NOT NULL
                    )
                );

CREATE TABLE lark_member_bot (
                    agent_id TEXT PRIMARY KEY REFERENCES agent_profile(id),
                    account_id TEXT NOT NULL REFERENCES lark_account(id),
                    app_id TEXT NOT NULL UNIQUE,
                    bot_open_id TEXT,
                    bot_display_name TEXT NOT NULL CHECK(length(trim(bot_display_name)) > 0),
                    credential_ref TEXT NOT NULL UNIQUE CHECK(length(trim(credential_ref)) > 0),
                    status TEXT NOT NULL CHECK(status IN (
                        'provisioning', 'published', 'failed', 'disabled'
                    )),
                    failure_code TEXT,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    published_at TEXT,
                    CHECK(
                        (status = 'published' AND published_at IS NOT NULL AND failure_code IS NULL)
                        OR status <> 'published'
                    )
                );

CREATE TABLE lark_member_bot_publication_intent (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL REFERENCES agent_profile(id),
                account_id TEXT NOT NULL REFERENCES lark_account(id),
                expected_user_id_digest TEXT NOT NULL
                    CHECK(length(trim(expected_user_id_digest)) > 0),
                expected_tenant_id TEXT NOT NULL CHECK(length(trim(expected_tenant_id)) > 0),
                requested_app_name TEXT NOT NULL CHECK(length(trim(requested_app_name)) > 0),
                provisioning_mode TEXT NOT NULL
                    CHECK(provisioning_mode = 'developer_session'),
                state TEXT NOT NULL CHECK(state IN (
                    'created', 'session_verified', 'app_created', 'credentials_read',
                    'bot_configured', 'version_published', 'connection_verified',
                    'completed', 'failed_recoverable', 'failed_unknown_remote_state'
                )),
                remote_app_id TEXT,
                credential_ref TEXT,
                last_completed_step TEXT,
                failure_code TEXT,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK(
                    (state = 'failed_unknown_remote_state' AND failure_code IS NOT NULL)
                    OR state <> 'failed_unknown_remote_state'
                )
            );

CREATE UNIQUE INDEX lark_account_single_connected_idx
                    ON lark_account(status) WHERE status = 'connected';

CREATE INDEX lark_member_bot_status_idx
                    ON lark_member_bot(status, updated_at DESC, agent_id);

CREATE INDEX lark_member_bot_publication_intent_agent_idx
                ON lark_member_bot_publication_intent(agent_id, created_at DESC, id);

CREATE UNIQUE INDEX lark_member_bot_publication_intent_active_agent_idx
                ON lark_member_bot_publication_intent(agent_id)
                WHERE state NOT IN ('completed', 'failed_recoverable');

CREATE INDEX lark_owner_app_identity_app_idx
                    ON lark_owner_app_identity(app_id, account_id);

CREATE TABLE channel_credentials_v175 (
                credential_ref TEXT PRIMARY KEY NOT NULL
                    CHECK(length(trim(credential_ref)) > 0 AND length(credential_ref) <= 128),
                provider TEXT NOT NULL CHECK(provider IN ('feishu', 'dingtalk', 'lark')),
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

INSERT INTO channel_credentials_v175 SELECT * FROM channel_credentials;

DROP TABLE channel_credentials;

ALTER TABLE channel_credentials_v175 RENAME TO channel_credentials;

CREATE INDEX channel_credentials_provider_idx
                ON channel_credentials(provider);

CREATE INDEX channel_credentials_remote_app_idx
                ON channel_credentials(provider, remote_app_id);

CREATE TABLE channel_developer_sessions_v175 (
                provider TEXT PRIMARY KEY NOT NULL CHECK(provider IN ('feishu', 'dingtalk', 'lark')),
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

INSERT INTO channel_developer_sessions_v175 SELECT * FROM channel_developer_sessions;

DROP TABLE channel_developer_sessions;

ALTER TABLE channel_developer_sessions_v175 RENAME TO channel_developer_sessions;

CREATE TABLE automation_notification_delivery_v175 (
                id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
                automation_run_id TEXT NOT NULL
                    REFERENCES automation_run(id) ON DELETE CASCADE,
                provider TEXT NOT NULL CHECK(provider IN ('feishu', 'dingtalk', 'lark')),
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

INSERT INTO automation_notification_delivery_v175 SELECT * FROM automation_notification_delivery;

DROP TABLE automation_notification_delivery;

ALTER TABLE automation_notification_delivery_v175 RENAME TO automation_notification_delivery;

CREATE INDEX automation_notification_claim_idx
                ON automation_notification_delivery(provider, status, available_at, created_at, id)
                WHERE status IN ('pending', 'attempting');

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
            FROM dingtalk_member_bot
UNION ALL
SELECT 'lark' AS provider, agent_id, account_id, app_id,
                   app_id AS remote_app_id, NULL AS robot_code,
                   bot_display_name, credential_ref, status, failure_code,
                   version, 'open_id' AS owner_identity_kind
            FROM lark_member_bot;

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
            FROM dingtalk_owner_app_identity
UNION ALL
SELECT 'lark' AS provider, app_id, account_id,
                   'open_id' AS identity_kind, open_id_digest AS identity_digest,
                   version, updated_at
            FROM lark_owner_app_identity;
