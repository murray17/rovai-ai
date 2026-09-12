use anyhow::{Result, ensure};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// A Host-verified editor, independent of a short-lived authentication Session.
/// Network callers cannot deserialize this onto a Core request. The trusted
/// transport constructs it only after verifying the Owner and resumption proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct DraftClient(String);

impl Default for DraftClient {
    fn default() -> Self {
        Self("desktop".to_owned())
    }
}

impl DraftClient {
    pub fn verified_web(id: &str) -> Result<Self> {
        ensure!(
            id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()),
            "invalid editor identity"
        );
        Ok(Self(id.to_owned()))
    }

    pub fn is_desktop(&self) -> bool {
        self.0 == "desktop"
    }
    pub fn id(&self) -> &str {
        &self.0
    }

    // Closed ASCII identity, never user text. Kept private to the Rust library;
    // SQL values are used only at explicitly scoped Draft/Prepared predicates.
    pub(crate) fn sql_key(&self) -> &str {
        &self.0
    }
    pub fn draft_id(&self, camp_id: &str) -> String {
        format!("{camp_id}/{}", self.0)
    }
}

impl TryFrom<String> for DraftClient {
    type Error = anyhow::Error;
    fn try_from(value: String) -> Result<Self> {
        if value == "desktop" {
            Ok(Self::default())
        } else {
            Self::verified_web(&value)
        }
    }
}
impl From<DraftClient> for String {
    fn from(value: DraftClient) -> Self {
        value.0
    }
}

// This is a trusted Host authentication seam, not an admitted Web operation.
// Only proof digests are persisted. Fresh Owner authentication is required by
// the Host before every call; an editor proof cannot authenticate a Session.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorResume {
    pub client_id: String,
    pub proof: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorIdentity {
    pub client_id: String,
    pub proof: String,
    pub owner_id: &'static str,
}

fn random_identity() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| anyhow::anyhow!("editor random source unavailable"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(crate) fn resolve_editor(
    database: &crate::db::Database,
    resume: Option<EditorResume>,
) -> Result<EditorIdentity> {
    let owner_id = crate::current_user::CURRENT_USER_ID;
    let (client_id, proof) =
        if let Some(resume) = resume {
            DraftClient::verified_web(&resume.client_id)?;
            DraftClient::verified_web(&resume.proof)?;
            let expected: Option<Vec<u8>> = database.connection().query_row(
            "SELECT proof_digest FROM web_editor_identity WHERE client_id=?1 AND owner_id=?2",
            params![resume.client_id, owner_id], |row| row.get(0),
        ).optional()?;
            let candidate = Sha256::digest(resume.proof.as_bytes());
            ensure!(
                expected.is_some_and(|expected| bool::from(
                    expected.as_slice().ct_eq(candidate.as_slice())
                )),
                "editor resume denied"
            );
            (resume.client_id, resume.proof)
        } else {
            let client_id = random_identity()?;
            let proof = random_identity()?;
            let digest = Sha256::digest(proof.as_bytes());
            database.connection().execute(
            "INSERT INTO web_editor_identity(client_id, owner_id, proof_digest) VALUES(?1,?2,?3)",
            params![client_id, owner_id, digest.as_slice()],
        )?;
            (client_id, proof)
        };
    Ok(EditorIdentity {
        client_id,
        proof,
        owner_id,
    })
}
