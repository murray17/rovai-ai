//! Owns connected-component completion, with the production SQL and a minimal relational fixture.
use rusqlite::{Connection, params};

#[test]
fn round_waits_for_all_inputs_fanout_and_transitive_deliveries_without_merging_a_camp() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE notification_preference(singleton INTEGER); CREATE TABLE camp(id TEXT PRIMARY KEY);
      CREATE TABLE agent_run(id TEXT PRIMARY KEY,camp_id TEXT,invocation_kind TEXT,status TEXT);
      CREATE TABLE camp_message(id TEXT PRIMARY KEY,camp_id TEXT,sequence INTEGER,author_type TEXT,source_agent_run_id TEXT,tombstoned_at TEXT);
      CREATE TABLE agent_run_input(agent_run_id TEXT,message_id TEXT);
      CREATE TABLE camp_message_delivery(message_id TEXT,claimed_agent_run_id TEXT,status TEXT);
      CREATE TABLE event_log(entity_type TEXT,event_type TEXT,entity_id TEXT);
      INSERT INTO camp VALUES('camp');").unwrap();
    db.execute_batch(include_str!("notification_model_schema.sql"))
        .unwrap();
    let publish = |id: &str, author: &str, run: Option<&str>| {
        db.execute("INSERT INTO camp_message VALUES(?1,'camp',(SELECT count(*)+1 FROM camp_message),?2,?3,NULL)",params![id,author,run]).unwrap();
        db.execute(
            "INSERT INTO event_log VALUES('camp_message','camp_message.sent',?1)",
            [id],
        )
        .unwrap();
    };
    let claim = |run: &str, inputs: &[&str]| {
        db.execute(
            "INSERT INTO agent_run VALUES(?1,'camp','batch','running')",
            [run],
        )
        .unwrap();
        for input in inputs {
            db.execute(
                "INSERT INTO agent_run_input VALUES(?1,?2)",
                params![run, input],
            )
            .unwrap();
            db.execute(
                "INSERT INTO camp_message_delivery VALUES(?1,?2,'claimed')",
                params![input, run],
            )
            .unwrap();
        }
    };
    let finish = |run: &str, status: &str| {
        db.execute(
            "UPDATE agent_run SET status=?2 WHERE id=?1",
            params![run, status],
        )
        .unwrap();
        db.execute(
            "UPDATE camp_message_delivery SET status='settled' WHERE claimed_agent_run_id=?1",
            [run],
        )
        .unwrap();
    };
    let count = || {
        db.query_row("SELECT count(*) FROM notification_round", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
    };
    publish("u1", "user", None);
    publish("u2", "external_principal", None);
    claim("a", &["u1", "u2"]);
    claim("b", &["u1"]);
    publish("a2a", "agent", Some("a"));
    db.execute(
        "INSERT INTO camp_message_delivery VALUES('a2a',NULL,'waiting')",
        [],
    )
    .unwrap();
    finish("a", "succeeded");
    finish("b", "succeeded");
    assert_eq!(
        count(),
        0,
        "waiting A2A is part of the chain even before it has a Run"
    );
    publish("unrelated", "user", None);
    claim("unrelated-run", &["unrelated"]);
    finish("unrelated-run", "succeeded");
    assert_eq!(count(), 1, "same Camp is not a causal edge");
    publish("u3", "user", None);
    claim("c", &["a2a", "u3"]);
    db.execute(
        "DELETE FROM camp_message_delivery WHERE claimed_agent_run_id IS NULL",
        [],
    )
    .unwrap();
    finish("c", "succeeded");
    assert_eq!(count(), 2, "co-claimed roots and fanout merge transitively");
    let runs: String = db
        .query_row(
            "SELECT run_ids_json FROM notification_round WHERE id='u1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Vec<String>>(&runs).unwrap(),
        ["a", "b", "c"]
    );
    finish("c", "succeeded");
    db.execute(
        "INSERT INTO event_log VALUES('camp_message','camp_message.public_a2a_sent','a2a')",
        [],
    )
    .unwrap();
    assert_eq!(
        count(),
        2,
        "replayed terminal/publication writes do not duplicate rounds"
    );
    for state in ["failed", "cancelled", "waiting", "queued"] {
        let root = format!("root-{state}");
        publish(&root, "user", None);
        claim(state, &[&root]);
        finish(state, state);
        // A successful sibling cannot hide an unsuccessful or pending branch.
        let sibling = format!("sibling-{state}");
        claim(&sibling, &[&root]);
        finish(&sibling, "succeeded");
    }
    assert_eq!(count(), 2, "all branches must succeed");
    assert_eq!(
        db.query_row("SELECT count(*) FROM notification_round_probe", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
}
