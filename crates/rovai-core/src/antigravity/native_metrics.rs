//! Numeric-only reader for Antigravity's current native trajectory database.
//! The field numbers are from the installed cortex/codeium_common protobuf
//! descriptors, not a CLI version allowlist. Unknown shapes fail closed.
use crate::monitoring::{
    ParsedRuntimeUsage, RuntimeInputSemantics, RuntimeUsageCounterMode, RuntimeUsageFields,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_BLOB_BYTES: usize = 2 * 1024 * 1024;
const MAX_FIELDS: usize = 512;

pub(super) struct NativeMetrics {
    pub call_index: u64,
    pub usage: ParsedRuntimeUsage,
    pub context: Option<ParsedRuntimeUsage>,
}

pub(super) fn root_for_command(command: &std::process::Command) -> Option<PathBuf> {
    let name = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = match command.get_envs().find(|(key, _)| *key == name) {
        Some((_, value)) => PathBuf::from(value?),
        None => dirs::home_dir()?,
    };
    home.is_absolute()
        .then(|| home.join(".gemini/antigravity-cli/conversations"))
}

pub(super) async fn read(
    root: &Path,
    input_step: u64,
    step: u64,
    wire: &ParsedRuntimeUsage,
) -> Option<NativeMetrics> {
    let root = root.to_owned();
    let wire = wire.clone();
    tokio::task::spawn_blocking(move || read_checked(&root, input_step, step, &wire))
        .await
        .ok()
        .flatten()
}

fn read_checked(
    root: &Path,
    input_step: u64,
    step: u64,
    wire: &ParsedRuntimeUsage,
) -> Option<NativeMetrics> {
    let session = wire.native_session_id.as_deref()?;
    let uuid = uuid::Uuid::parse_str(session).ok()?;
    if uuid.to_string() != session || step <= input_step {
        return None;
    }
    let path = fs::canonicalize(root).ok()?.join(format!("{session}.db"));
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return None;
    }
    let database = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .ok()?;
    database.busy_timeout(Duration::from_millis(50)).ok()?;
    // One read transaction prevents pairing rows from different native writes.
    database.execute_batch("BEGIN DEFERRED").ok()?;
    let (trajectory, owner) = database
        .query_row(
            "SELECT trajectory_id,cascade_id FROM trajectory_meta LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok()?;
    if owner != session || uuid::Uuid::parse_str(&trajectory).is_err() {
        return None;
    }
    let input = step_metadata(&database, input_step)?;
    let current = step_metadata(&database, step)?;
    // Native enum values: CortexStepStatus.DONE=3, USER_INPUT=14,
    // PLANNER_RESPONSE=15. The stream independently verifies DONE/root/type.
    if input.kind != 14
        || current.kind != 15
        || input.execution != current.execution
        || !input.matches(&trajectory, session, input_step)
        || !current.matches(&trajectory, session, step)
    {
        return None;
    }
    let usage = current.usage?;
    if Some(usage.input) != wire.fields.input_tokens
        || Some(usage.output) != wire.fields.output_tokens
        || Some(usage.read) != wire.fields.cache_read_input_tokens
        || wire
            .fields
            .reasoning_output_tokens
            .is_some_and(|n| n != usage.thinking)
        || usage.model != current.model
    {
        return None;
    }
    usage
        .input
        .checked_add(usage.read)?
        .checked_add(usage.write)?;
    let mut observation = wire.clone();
    observation.identity_suffix = format!("native_call:{}", current.generator);
    observation.dialect_id = "antigravity-native-model-usage-v1".into();
    observation.source = "runtime_private_extension".into();
    observation.input_semantics = RuntimeInputSemantics::ExclusiveBuckets;
    observation.fields = RuntimeUsageFields {
        input_tokens: Some(usage.input),
        uncached_input_tokens: Some(usage.input),
        output_tokens: Some(usage.output),
        reasoning_output_tokens: Some(usage.thinking),
        cache_read_input_tokens: Some(usage.read),
        cache_write_input_tokens: Some(usage.write),
        ..Default::default()
    };
    let context =
        read_context(&database, &current, step).map(|(used, window)| ParsedRuntimeUsage {
            identity_suffix: format!("native_context:{}", current.generator),
            dialect_id: "antigravity-native-context-v1".into(),
            source: "runtime_private_extension".into(),
            scope: "session".into(),
            counter_mode: RuntimeUsageCounterMode::Gauge,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: Some(session.into()),
            native_turn_id: None,
            fields: RuntimeUsageFields {
                context_used_tokens: used,
                context_size_tokens: window,
                ..Default::default()
            },
            cost: None,
            context_model_id: Some(format!("antigravity-model:{}", current.model)),
            occurred_at: None,
        });
    Some(NativeMetrics {
        call_index: current.generator,
        usage: observation,
        context,
    })
}

struct StepMetadata {
    kind: i64,
    trajectory: String,
    session: String,
    step: u64,
    generator: u64,
    execution: String,
    model: u64,
    usage: Option<ModelUsage>,
}
impl StepMetadata {
    fn matches(&self, trajectory: &str, session: &str, step: u64) -> bool {
        self.trajectory == trajectory && self.session == session && self.step == step
    }
}

fn step_metadata(database: &Connection, index: u64) -> Option<StepMetadata> {
    database.query_row(
        "SELECT step_type,metadata FROM steps WHERE idx=?1 AND status=3 AND has_subtrajectory=0 AND length(metadata)<=?2",
        rusqlite::params![i64::try_from(index).ok()?, MAX_BLOB_BYTES as i64],
        |row| Ok((|| {
            let metadata = Fields::parse(row.get_ref(1).ok()?.as_blob().ok()?)?;
            let source = Fields::parse(metadata.bytes(20)?)?;
            Some(StepMetadata {
                kind: row.get(0).ok()?, trajectory: source.id(1)?, session: source.id(4)?,
                step: source.scalar_or_zero(2)?, generator: source.scalar_or_zero(3)?,
                execution: metadata.id(12)?, model: metadata.scalar_or_zero(11)?,
                usage: metadata.bytes(9).and_then(ModelUsage::parse),
            })
        })()),
    ).optional().ok().flatten().flatten()
}

#[derive(Clone, Copy, PartialEq)]
struct ModelUsage {
    model: u64,
    input: i64,
    output: i64,
    write: i64,
    read: i64,
    thinking: i64,
}
impl ModelUsage {
    fn parse(bytes: &[u8]) -> Option<Self> {
        let f = Fields::parse(bytes)?;
        // A populated, typed ModelUsageStats is required. In this native proto3
        // message cache bucket scalars default to zero. A missing parent or an
        // all-default placeholder is not an observation. Stream counts must agree.
        if f.scalar(1)? == 0 || f.scalar(6)? == 0 {
            return None;
        }
        let count = |key| i64::try_from(f.scalar_or_zero(key)?).ok();
        let value = Self {
            model: f.scalar(1)?,
            input: count(2)?,
            output: count(3)?,
            write: count(4)?,
            read: count(5)?,
            thinking: count(9)?,
        };
        if value.thinking > value.output
            || value
                .input
                .checked_add(value.output)?
                .checked_add(value.read)?
                .checked_add(value.write)?
                == 0
        {
            return None;
        }
        Some(value)
    }
}

fn read_context(
    database: &Connection,
    step: &StepMetadata,
    index: u64,
) -> Option<(Option<i64>, Option<i64>)> {
    // metadata_index is a native PK, so no Session-history scan is needed.
    database
        .query_row(
            "SELECT data FROM gen_metadata WHERE idx=?1 AND length(data)<=?2",
            rusqlite::params![i64::try_from(step.generator).ok()?, MAX_BLOB_BYTES as i64],
            |row| {
                Ok((|| {
                    let generator = Fields::parse(row.get_ref(0).ok()?.as_blob().ok()?)?;
                    if generator.id(4)? != step.execution
                        || generator.bytes(7).is_some()
                        || !generator.includes_index(2, index)?
                    {
                        return None;
                    }
                    let chat = Fields::parse(generator.bytes(1)?)?;
                    if chat.scalar(3)? != step.model
                        || ModelUsage::parse(chat.bytes(4)?)? != *step.usage.as_ref()?
                    {
                        return None;
                    }
                    let start = Fields::parse(chat.bytes(9)?)?;
                    let context = Fields::parse(start.bytes(10)?)?;
                    // Unlike protobuf counters, absence of used is not a measured empty window.
                    let used = context
                        .scalar(1)
                        .and_then(|n| i64::try_from(n).ok())
                        .filter(|n| *n <= 9_007_199_254_740_991);
                    let window = context
                        .scalar(4)
                        .and_then(|n| i64::try_from(n).ok())
                        .filter(|n| *n <= i32::MAX as i64);
                    (used.is_some() || window.is_some()).then_some((used, window))
                })())
            },
        )
        .optional()
        .ok()
        .flatten()
        .flatten()
}

// Bounded protobuf wire walker. Borrowed unknown fields (including prompts,
// thoughts, tool arguments and response headers) are skipped, never decoded,
// copied into strings, hashed, logged or sent through the metrics channel.
#[derive(Clone, Copy)]
enum Field<'a> {
    Scalar(u64),
    Bytes(&'a [u8]),
    Other,
}
struct Fields<'a>(Vec<(u32, Field<'a>)>);
impl<'a> Fields<'a> {
    fn parse(mut bytes: &'a [u8]) -> Option<Self> {
        if bytes.len() > MAX_BLOB_BYTES {
            return None;
        }
        let mut fields = Vec::new();
        while !bytes.is_empty() {
            if fields.len() >= MAX_FIELDS {
                return None;
            }
            let tag = varint(&mut bytes)?;
            let number = u32::try_from(tag >> 3)
                .ok()
                .filter(|n| *n > 0 && *n < (1 << 29))?;
            let value = match tag & 7 {
                0 => Field::Scalar(varint(&mut bytes)?),
                1 => {
                    take(&mut bytes, 8)?;
                    Field::Other
                }
                2 => {
                    let size = usize::try_from(varint(&mut bytes)?).ok()?;
                    Field::Bytes(take(&mut bytes, size)?)
                }
                5 => {
                    take(&mut bytes, 4)?;
                    Field::Other
                }
                _ => return None,
            };
            fields.push((number, value));
        }
        Some(Self(fields))
    }
    fn one(&self, key: u32) -> Option<Field<'a>> {
        let mut values = self.0.iter().filter(|(n, _)| *n == key);
        let value = values.next()?.1;
        values.next().is_none().then_some(value)
    }
    fn scalar(&self, key: u32) -> Option<u64> {
        match self.one(key)? {
            Field::Scalar(n) => Some(n),
            _ => None,
        }
    }
    fn scalar_or_zero(&self, key: u32) -> Option<u64> {
        if self.0.iter().any(|(n, _)| *n == key) {
            self.scalar(key)
        } else {
            Some(0)
        }
    }
    fn bytes(&self, key: u32) -> Option<&'a [u8]> {
        match self.one(key)? {
            Field::Bytes(b) => Some(b),
            _ => None,
        }
    }
    fn id(&self, key: u32) -> Option<String> {
        let s = std::str::from_utf8(self.bytes(key)?).ok()?;
        (uuid::Uuid::parse_str(s).ok()?.to_string() == s).then(|| s.to_owned())
    }
    fn includes_index(&self, key: u32, expected: u64) -> Option<bool> {
        let mut found = false;
        let mut count = 0;
        for (_, field) in self.0.iter().filter(|(n, _)| *n == key) {
            match *field {
                Field::Scalar(n) => {
                    count += 1;
                    found |= n == expected;
                }
                Field::Bytes(mut packed) => {
                    while !packed.is_empty() {
                        if count >= MAX_FIELDS {
                            return None;
                        }
                        count += 1;
                        found |= varint(&mut packed)? == expected;
                    }
                }
                Field::Other => return None,
            }
        }
        Some(found)
    }
}
fn take<'a>(bytes: &mut &'a [u8], size: usize) -> Option<&'a [u8]> {
    let (head, tail) = bytes.split_at_checked(size)?;
    *bytes = tail;
    Some(head)
}
fn varint(bytes: &mut &[u8]) -> Option<u64> {
    let mut value = 0u64;
    for i in 0..10 {
        let byte = take(bytes, 1)?[0];
        if i == 9 && byte > 1 {
            return None;
        }
        value |= u64::from(byte & 127) << (i * 7);
        if byte < 128 {
            return Some(value);
        }
    }
    None
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    use crate::antigravity::{AntigravityStreamCapture, process_antigravity_stream_line};
    use serde_json::json;
    const SESSION: &str = "0bdd2166-d420-40c6-94be-70b93eb290c5";
    const TRAJECTORY: &str = "01cd685c-4bd2-49d1-be94-d342abf7a63d";
    const EXECUTION: &str = "a48a3a49-4814-4f9a-8232-3a3cf6d1f54b";
    fn number(mut n: u64) -> Vec<u8> {
        let mut b = Vec::new();
        while n >= 128 {
            b.push(n as u8 | 128);
            n >>= 7;
        }
        b.push(n as u8);
        b
    }
    fn scalar(key: u64, n: u64) -> Vec<u8> {
        [number(key << 3), number(n)].concat()
    }
    fn bytes(key: u64, b: &[u8]) -> Vec<u8> {
        [number((key << 3) | 2), number(b.len() as u64), b.to_vec()].concat()
    }
    fn usage() -> Vec<u8> {
        [
            scalar(1, 7),
            scalar(2, 30),
            scalar(3, 10),
            scalar(5, 20),
            scalar(6, 24),
            scalar(9, 2),
            bytes(8, b"PRIVATE_NATIVE_HEADER"),
        ]
        .concat()
    }
    fn metadata(index: u64, with_usage: bool) -> Vec<u8> {
        let source = [
            bytes(1, TRAJECTORY.as_bytes()),
            scalar(2, index),
            scalar(3, 2),
            bytes(4, SESSION.as_bytes()),
        ]
        .concat();
        let mut result = [
            bytes(12, EXECUTION.as_bytes()),
            bytes(20, &source),
            bytes(30, b"PRIVATE_NATIVE_THOUGHT"),
        ]
        .concat();
        if with_usage {
            result.extend(scalar(11, 7));
            result.extend(bytes(9, &usage()));
        }
        result
    }
    fn generator(used: u64, window: u64) -> Vec<u8> {
        partial_generator(Some(used), Some(window))
    }
    fn partial_generator(used: Option<u64>, window: Option<u64>) -> Vec<u8> {
        let context = [used.map(|n| scalar(1, n)), window.map(|n| scalar(4, n))]
            .into_iter()
            .flatten()
            .flatten()
            .collect::<Vec<_>>();
        let chat = [
            scalar(3, 7),
            bytes(4, &usage()),
            bytes(9, &bytes(10, &context)),
            bytes(1, b"PRIVATE_NATIVE_PROMPT"),
        ]
        .concat();
        [
            bytes(2, &number(5)),
            bytes(1, &chat),
            bytes(4, EXECUTION.as_bytes()),
        ]
        .concat()
    }

    // New owner: native SQLite/protobuf -> stream replacement -> private numeric
    // event. The existing stream-only owner cannot verify this storage boundary.
    // Temporary data only; no Runtime, network, real native home or credentials.
    #[tokio::test]
    async fn native_database_supplements_only_the_current_completed_call() {
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-numbers-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).unwrap();
        let path = root.join(format!("{SESSION}.db"));
        let database = Connection::open(&path).unwrap();
        database.execute_batch("CREATE TABLE trajectory_meta(trajectory_id TEXT,cascade_id TEXT); CREATE TABLE steps(idx INTEGER PRIMARY KEY,step_type INTEGER,status INTEGER,has_subtrajectory INTEGER,metadata BLOB); CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB);").unwrap();
        database
            .execute(
                "INSERT INTO trajectory_meta VALUES(?1,?2)",
                rusqlite::params![TRAJECTORY, SESSION],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO steps VALUES(3,14,3,0,?1)",
                [metadata(3, false)],
            )
            .unwrap();
        database
            .execute("INSERT INTO steps VALUES(5,15,3,0,?1)", [metadata(5, true)])
            .unwrap();
        database
            .execute(
                "INSERT INTO gen_metadata VALUES(2,?1)",
                [generator(40, 100)],
            )
            .unwrap();
        let step = json!({"conversation_id":SESSION,"step_index":5,"state":"DONE","step_type":"agent_response","usage":{"input_tokens":30,"output_tokens":10,"cache_read_tokens":20,"thinking_tokens":2}});
        let wire = crate::monitoring::parse_antigravity_step_usage(&step).unwrap();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let mut capture = AntigravityStreamCapture {
            native_metrics_root: Some(root.clone()),
            ..Default::default()
        };
        for payload in [
            json!({"conversation_id":SESSION,"step_index":3,"state":"DONE","step_type":"user_input"}),
            step.clone(),
            step.clone(),
        ] {
            process_antigravity_stream_line(
                json!({"event":"step_update","step_update":payload})
                    .to_string()
                    .as_bytes(),
                Some(SESSION),
                Some(&sender),
                &mut capture,
                Path::new("/unused-native-log"),
            )
            .await
            .unwrap();
        }
        let usage_event = receiver.try_recv().unwrap();
        assert_eq!(
            usage_event.payload["dialectId"], "antigravity-native-model-usage-v1",
            "{usage_event:?}"
        );
        let context_event = receiver.try_recv().unwrap();
        let observed: ParsedRuntimeUsage =
            serde_json::from_value(usage_event.payload.clone()).unwrap();
        assert_eq!(
            observed.input_semantics,
            RuntimeInputSemantics::ExclusiveBuckets
        );
        assert_eq!(observed.fields.input_tokens, Some(30));
        assert_eq!(observed.fields.uncached_input_tokens, Some(30));
        assert_eq!(observed.fields.cache_read_input_tokens, Some(20));
        assert_eq!(observed.fields.cache_write_input_tokens, Some(0));
        assert_eq!(context_event.payload["fields"]["contextUsedTokens"], 40);
        assert_eq!(context_event.payload["fields"]["contextSizeTokens"], 100);
        assert!(!format!("{usage_event:?}{context_event:?}").contains("PRIVATE_NATIVE"));
        assert!(receiver.try_recv().is_err());
        assert_eq!(capture.observed_native_calls.len(), 1);
        // Native call identity also prevents two steps from charging one call.
        database
            .execute("INSERT INTO steps VALUES(6,15,3,0,?1)", [metadata(6, true)])
            .unwrap();
        let mut repeated_call = step.clone();
        repeated_call["step_index"] = json!(6);
        process_antigravity_stream_line(
            json!({"event":"step_update","step_update":repeated_call})
                .to_string()
                .as_bytes(),
            Some(SESSION),
            Some(&sender),
            &mut capture,
            Path::new("/unused-native-log"),
        )
        .await
        .unwrap();
        assert!(receiver.try_recv().is_err());
        // Gauge pairs replace earlier values, including decreases; window-only
        // and malformed/out-of-range data never make a synthetic 0%.
        for (blob, used, window) in [
            (generator(12, 100), Some(12), Some(100)),
            (generator(101, 100), Some(101), Some(100)),
            (generator(12, 0), Some(12), Some(0)),
            (partial_generator(Some(12), None), Some(12), None),
            (partial_generator(None, Some(100)), None, Some(100)),
            (vec![0x0a, 0xff], None, None),
        ] {
            database
                .execute("UPDATE gen_metadata SET data=?1 WHERE idx=2", [blob])
                .unwrap();
            let result = read_checked(&root, 3, 5, &wire).unwrap();
            assert_eq!(
                result
                    .context
                    .as_ref()
                    .and_then(|c| c.fields.context_used_tokens),
                used
            );
            assert_eq!(
                result.context.and_then(|c| c.fields.context_size_tokens),
                window
            );
            assert_eq!(result.usage.fields.output_tokens, Some(10));
        }
        assert!(read_checked(&root, 5, 5, &wire).is_none());
        let mut wrong = wire.clone();
        wrong.fields.input_tokens = Some(999);
        assert!(read_checked(&root, 3, 5, &wrong).is_none());
        wrong = wire.clone();
        wrong.native_session_id = Some("../outside".into());
        assert!(read_checked(&root, 3, 5, &wrong).is_none());
        for corrupt in [
            bytes(9, &usage()),
            [metadata(5, true), bytes(12, SESSION.as_bytes())].concat(),
            vec![0x80; 11],
            [metadata(5, true), bytes(9, b"bad")].concat(),
        ] {
            database
                .execute("UPDATE steps SET metadata=?1 WHERE idx=5", [corrupt])
                .unwrap();
            assert!(read_checked(&root, 3, 5, &wire).is_none());
        }
        database
            .execute(
                "UPDATE steps SET metadata=?1 WHERE idx=5",
                [metadata(5, true)],
            )
            .unwrap();
        database
            .execute("UPDATE trajectory_meta SET cascade_id=?1", [TRAJECTORY])
            .unwrap();
        assert!(read_checked(&root, 3, 5, &wire).is_none());
        database
            .execute("UPDATE trajectory_meta SET cascade_id=?1", [SESSION])
            .unwrap();
        database
            .execute("UPDATE steps SET has_subtrajectory=1 WHERE idx=5", [])
            .unwrap();
        assert!(read_checked(&root, 3, 5, &wire).is_none());
        // Wrong scalar wire type/duplicate counts must not become proto3 zeros.
        for invalid in [
            [usage(), bytes(4, b"invalid")].concat(),
            [usage(), scalar(5, 3)].concat(),
            [usage(), scalar(4, u64::MAX)].concat(),
            vec![],
        ] {
            assert!(ModelUsage::parse(&invalid).is_none());
        }
        assert!(Fields::parse(&[0]).is_none());
        assert!(Fields::parse(&[0x0a, 0x7f]).is_none());
        assert!(Fields::parse(&vec![0; MAX_BLOB_BYTES + 1]).is_none());
        drop(database);
        #[cfg(unix)]
        {
            let real = root.join("saved.db");
            fs::rename(&path, &real).unwrap();
            std::os::unix::fs::symlink(&real, &path).unwrap();
            assert!(read_checked(&root, 3, 5, &wire).is_none());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
