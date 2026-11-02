//! Runtime-scoped shared variables. Reuses the private credential codec and validation.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edit {
    pub expected_revision: i64,
    pub json: String,
}

pub struct Prepared {
    kind: AdapterKind,
    expected_revision: i64,
    ciphertext: Vec<u8>,
    pub changed: bool,
}

fn revision(c: &Connection, kind: AdapterKind) -> Result<i64> {
    Ok(c.query_row(
        "SELECT COALESCE(MAX(revision),0) FROM runtime_common_environment WHERE runtime_kind=?1",
        [kind.as_str()],
        |r| r.get(0),
    )?)
}
fn read(c: &Connection, kind: AdapterKind, revision: i64) -> Result<Environment> {
    if revision == 0 {
        return Ok(Environment::new());
    }
    let bytes: Vec<u8> = c.query_row("SELECT ciphertext FROM runtime_common_environment WHERE runtime_kind=?1 AND revision=?2",
        params![kind.as_str(),revision], |r| r.get(0)).context("Common environment revision is unavailable")?;
    decrypt(c, &format!("common:{}:{revision}", kind.as_str()), &bytes)
}
pub fn current(c: &Connection, kind: AdapterKind) -> Result<Environment> {
    read(c, kind, revision(c, kind)?)
}
pub fn get(c: &Connection, kind: AdapterKind) -> Result<Value> {
    let revision = revision(c, kind)?;
    Ok(match read(c, kind, revision) {
        Ok(environment) => json!({"revision":revision, "environment":environment}),
        Err(_) => {
            json!({"revision":revision, "environment":{}, "error":"通用环境变量无法读取。原记录已保留，请重新填写后保存。"})
        }
    })
}

pub fn resolve(c: &Connection, kind: AdapterKind, edit: &Edit) -> Result<Environment> {
    ensure!(
        edit.expected_revision >= 0 && edit.expected_revision < i64::MAX,
        "Invalid common environment revision"
    );
    ensure!(
        revision(c, kind)? == edit.expected_revision,
        "Common environment changed; reload the saved configuration"
    );
    parse(&edit.json, cfg!(windows))
}
pub fn prepare(c: &Connection, kind: AdapterKind, edit: Edit) -> Result<Prepared> {
    let values = resolve(c, kind, &edit)?;
    Ok(Prepared {
        kind,
        expected_revision: edit.expected_revision,
        // An explicit replacement is still protected by the existing revision
        // check. Preserve the damaged ciphertext as an older revision.
        changed: read(c, kind, edit.expected_revision).map_or(true, |saved| values != saved),
        ciphertext: encrypt(
            c,
            &format!("common:{}:{}", kind.as_str(), edit.expected_revision + 1),
            &values,
        )?,
    })
}
impl Prepared {
    /// Caller owns the transaction with startup preferences and cache invalidation.
    pub fn commit(&self, c: &Connection) -> Result<()> {
        ensure!(
            revision(c, self.kind)? == self.expected_revision,
            "Common environment changed; reload the saved configuration"
        );
        if self.changed {
            c.execute("INSERT INTO runtime_common_environment(runtime_kind,revision,ciphertext) VALUES(?1,?2,?3)",
                params![self.kind.as_str(),self.expected_revision+1,self.ciphertext])?;
        }
        Ok(())
    }
}

pub fn entries(values: Environment) -> Vec<RuntimeEnvironmentVariable> {
    values
        .into_iter()
        .map(|(name, value)| RuntimeEnvironmentVariable { name, value })
        .collect()
}
