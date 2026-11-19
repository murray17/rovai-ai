//! Transaction-scoped, metadata-only Host hints from actual public-message writes.
//! Handlers are synchronous. A scoped collector avoids plumbing a second argument
//! through every business helper; it is connection-fenced and cannot cross threads.
use std::{cell::RefCell, collections::BTreeMap, marker::PhantomData, rc::Rc};

use anyhow::Result;
use rusqlite::{Connection, Transaction};
use serde_json::json;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Default)]
struct Change {
    index_changed: bool,
    unavailable: Vec<String>,
}
struct Batch {
    connection: usize,
    output: UnboundedSender<String>,
    threads: BTreeMap<String, Change>,
    archives: BTreeMap<String, bool>,
}

fn connection_key(connection: &Connection) -> usize {
    // Compare the SQLite handle's identity only. The Rust Connection may move
    // between startup and the first transaction.
    unsafe { connection.handle() as usize }
}

pub(crate) fn record_archive(connection: &Connection, thread_id: &str) -> Result<()> {
    CURRENT.with(|current| {
        if let Some(batch) = current
            .borrow_mut()
            .as_mut()
            .filter(|batch| batch.connection == connection_key(connection))
        {
            let mission = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM mission WHERE camp_id=?1)",
                [thread_id],
                |row| row.get(0),
            )?;
            batch.archives.insert(thread_id.into(), mission);
        }
        Ok(())
    })
}

thread_local! {
    static CURRENT: RefCell<Option<Batch>> = const { RefCell::new(None) };
}

pub(crate) struct MessageChanges {
    previous: Option<Batch>,
    // This guard must remain on the synchronous command's thread until commit/drop.
    _same_thread: PhantomData<Rc<()>>,
}
impl MessageChanges {
    pub(crate) fn begin(connection: &Connection, output: Option<UnboundedSender<String>>) -> Self {
        let batch = output.map(|output| Batch {
            connection: connection_key(connection),
            output,
            threads: BTreeMap::new(),
            archives: BTreeMap::new(),
        });
        Self {
            previous: CURRENT.with(|current| current.replace(batch)),
            _same_thread: PhantomData,
        }
    }

    pub(crate) fn commit(self, transaction: Transaction<'_>) -> Result<()> {
        let batch = CURRENT.with(|current| current.take());
        anyhow::ensure!(
            batch
                .as_ref()
                .is_none_or(|batch| batch.connection == connection_key(&transaction)),
            "Message hints must commit with their owning connection"
        );
        // Only actual message writes need a read watermark, captured before commit.
        let through: i64 = if batch
            .as_ref()
            .is_some_and(|batch| !batch.threads.is_empty() || !batch.archives.is_empty())
        {
            transaction.query_row(
                "SELECT last_sequence FROM event_sequence WHERE singleton=1",
                [],
                |r| r.get(0),
            )?
        } else {
            0
        };
        transaction.commit()?;
        if let Some(batch) = batch {
            for (thread_id, mission) in batch.archives {
                let _ = batch.output.send(json!({ "method": "navigation.invalidated", "params": {
                    "threadId": thread_id, "scope": "group", "reason": "threads.archive_changed",
                    "throughGlobalSequence": through,
                }}).to_string());
                if mission {
                    let _ = batch.output.send(
                        json!({ "method": "missions.invalidated", "params": {
                            "threadId": thread_id, "reason": "threads.archive_changed",
                        }})
                        .to_string(),
                    );
                }
            }
            for (thread_id, change) in batch.threads {
                let _ = batch.output.send(json!({ "method": "thread.messages.changed", "params": {
                    "threadId": thread_id, "indexChanged": change.index_changed,
                    "unavailableMessageIds": change.unavailable, "throughGlobalSequence": through,
                }}).to_string());
            }
        }
        Ok(())
    }
}
impl Drop for MessageChanges {
    fn drop(&mut self) {
        // Handler/receipt/commit errors discard this batch; nested commands restore their owner.
        CURRENT.with(|current| current.replace(self.previous.take()));
    }
}

/// Call after appending the actual message event, while its transaction is still open.
/// No active Host owner means no work; unrelated commands never query navigation metadata.
pub(crate) fn record(
    connection: &Connection,
    thread_id: &str,
    index_changed: bool,
    unavailable_message_ids: &[String],
) {
    CURRENT.with(|current| {
        let mut current = current.borrow_mut();
        let Some(batch) = current
            .as_mut()
            .filter(|batch| batch.connection == connection_key(connection))
        else {
            return;
        };
        let change = batch.threads.entry(thread_id.into()).or_default();
        change.index_changed |= index_changed;
        change
            .unavailable
            .extend_from_slice(unavailable_message_ids);
    });
}

/// Aggregate deletion is the existing public-message deletion path. Capture IDs
/// before erasure; do not read bodies or query when there is no active Host batch.
pub(crate) fn record_deleted_thread(connection: &Connection, thread_id: &str) -> Result<()> {
    if !CURRENT.with(|current| {
        current
            .borrow()
            .as_ref()
            .is_some_and(|batch| batch.connection == connection_key(connection))
    }) {
        return Ok(());
    }
    let ids = connection
        .prepare("SELECT id FROM camp_message WHERE camp_id=?1")?
        .query_map([thread_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !ids.is_empty() {
        record(connection, thread_id, true, &ids);
    }
    Ok(())
}
