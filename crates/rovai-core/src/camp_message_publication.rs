//! Shared SQL fragments for the durable publication boundary of public Camp messages.
//!
//! `camp_message.sent` and `camp_message.public_a2a_sent` are two publication
//! events for the same public `camp_message` fact. Historical consumers must
//! resolve one deterministic publication sequence per message before applying a
//! global fence; joining the raw event rows directly can duplicate a message.

const PUBLIC_CAMP_MESSAGE_EVENT_TYPES_SQL: &str =
    "'camp_message.sent', 'camp_message.public_a2a_sent'";

/// Returns a predicate for a trusted SQL column expression containing an event type.
pub(crate) fn public_camp_message_event_predicate(event_type_column: &str) -> String {
    format!("{event_type_column} IN ({PUBLIC_CAMP_MESSAGE_EVENT_TYPES_SQL})")
}

/// Returns the shared CTE that resolves the first durable public publication
/// sequence for every Camp message.
pub(crate) fn public_camp_message_publication_cte() -> String {
    format!(
        r#"public_camp_message_publication(message_id, global_sequence) AS (
               SELECT entity_id, MIN(global_sequence)
               FROM event_log
               WHERE entity_type = 'camp_message'
                 AND {}
                 AND entity_id IS NOT NULL
                 AND global_sequence IS NOT NULL
               GROUP BY entity_id
           )"#,
        public_camp_message_event_predicate("event_type")
    )
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    #[test]
    fn publication_cte_accepts_both_public_events_and_deduplicates_by_first_sequence() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE event_log(
                    entity_type TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    entity_id TEXT,
                    global_sequence INTEGER
                );
                INSERT INTO event_log VALUES
                    ('camp_message', 'camp_message.public_a2a_sent', 'message-a', 7),
                    ('camp_message', 'camp_message.sent', 'message-a', 3),
                    ('camp_message', 'camp_message.public_a2a_sent', 'message-b', 5),
                    ('camp_message', 'camp_message.private_sent', 'message-c', 2),
                    ('task', 'camp_message.sent', 'message-d', 1),
                    ('camp_message', 'camp_message.sent', NULL, 9);
                "#,
            )
            .unwrap();

        let sql = format!(
            "WITH {} SELECT message_id, global_sequence FROM public_camp_message_publication ORDER BY message_id",
            public_camp_message_publication_cte()
        );
        let mut statement = connection.prepare(&sql).unwrap();
        let publications = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        assert_eq!(
            publications,
            vec![("message-a".to_string(), 3), ("message-b".to_string(), 5)]
        );
    }
}
