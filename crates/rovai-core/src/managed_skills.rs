//! Rovai's published Skill files. The old Skill Library and its revisions are
//! separate historical storage; this directory is ordinary, repairable data.

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::command::{
    ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
    DomainCommandGateway, canonical_json_digest, sealed,
};
use crate::db::Database;
use crate::platform::private_storage::prepare_private_directory;

pub const PLATFORM_SKILLS: [&str; 2] = ["cli-operations", "memory-stewardship"];
pub const TOOLBOX_SKILLS: [&str; 5] = [
    "campfire",
    "grill-duo",
    "grill-duo-with-docs",
    "member-studio",
    "review-duo",
];
pub const PUBLISHED_SKILLS: [&str; 9] = [
    "analyze-agent-codebase",
    "campfire",
    "cli-operations",
    "grill-duo",
    "grill-duo-with-docs",
    "member-studio",
    "memory-stewardship",
    "review-duo",
    "worktree",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillIndexEntry {
    pub name: String,
    pub desc: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxSkillView {
    pub name: String,
    pub description: Option<String>,
    pub member_ids: Vec<String>,
    pub version: String,
    pub source_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetToolboxMembersCommand {
    pub skill_name: String,
    pub member_ids: Vec<String>,
    pub expected_version: String,
}

impl sealed::Sealed for SetToolboxMembersCommand {}
impl DomainCommand for SetToolboxMembersCommand {
    const TYPE: &'static str = "toolbox.members.set";
}

#[derive(Debug, Serialize)]
struct SkillIndex<'a> {
    root: &'a str,
    skills: &'a [SkillIndexEntry],
}

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: Option<String>,
    description: String,
}

#[derive(Debug, Clone)]
pub struct ManagedSkills {
    root: PathBuf,
    resources: PathBuf,
}

pub fn managed_skills_root(data_dir: &Path) -> Result<PathBuf> {
    ensure!(
        data_dir.is_absolute(),
        "Core data directory must be absolute"
    );
    #[cfg(target_os = "macos")]
    if dirs::data_dir().is_some_and(|base| data_dir == base.join("Rovai-ai")) {
        return Ok(dirs::home_dir()
            .context("cannot resolve the executing Host home directory")?
            .join(".rovai")
            .join("skills"));
    }
    Ok(data_dir.join("skills"))
}

pub fn bundled_skill_resources() -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("ROVAI_BUNDLED_SKILLS_ROOT") {
        let path = PathBuf::from(path);
        ensure!(path.is_absolute(), "bundled Skills root must be absolute");
        return Ok(path);
    }
    let executable = std::env::current_exe().context("cannot locate Core executable")?;
    if let Some(resources) = executable
        .parent()
        .and_then(Path::parent)
        .map(|parent| parent.join("skills"))
        .filter(|path| path.join("cli-operations").join("SKILL.md").is_file())
    {
        return Ok(resources);
    }
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("skills");
    ensure!(
        source.join("cli-operations").join("SKILL.md").is_file(),
        "bundled Skill resources are unavailable"
    );
    Ok(source)
}

impl ManagedSkills {
    pub fn for_data_dir(data_dir: &Path) -> Result<Self> {
        Ok(Self {
            root: managed_skills_root(data_dir)?,
            resources: bundled_skill_resources()?,
        })
    }

    pub fn new(root: PathBuf, resources: PathBuf) -> Result<Self> {
        ensure!(root.is_absolute(), "managed Skills root must be absolute");
        ensure!(
            resources.is_absolute(),
            "bundled Skill resources must be absolute"
        );
        Ok(Self { root, resources })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Restores only named Rovai resources. Unknown entries and old revisions
    /// are left alone. A concurrent Core process is already fenced by data-dir
    /// admission; the lock also avoids two in-process preparations racing.
    pub fn sync(&self) -> Result<()> {
        static SYNC_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let _guard = SYNC_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| anyhow::anyhow!("managed Skill synchronization lock is poisoned"))?;
        prepare_private_directory(&self.root)?;
        for name in PUBLISHED_SKILLS {
            let source = self.resources.join(name);
            ensure!(
                source.join("SKILL.md").is_file(),
                "bundled Skill resource {name} is missing"
            );
            sync_directory(&source, &self.root.join(name))
                .with_context(|| format!("cannot synchronize managed Skill {name}"))?;
        }
        Ok(())
    }

    pub fn entry_path(&self, name: &str) -> Result<PathBuf> {
        ensure!(
            PUBLISHED_SKILLS.contains(&name),
            "unknown Rovai managed Skill"
        );
        Ok(self.root.join(name).join("SKILL.md"))
    }

    pub fn read_toolbox_content(&self, name: &str) -> Result<String> {
        ensure!(TOOLBOX_SKILLS.contains(&name), "unknown Toolbox Skill");
        let directory = self.root.join(name);
        let entry = self.entry_path(name)?;
        ensure!(
            !fs::symlink_metadata(&directory)?.file_type().is_symlink()
                && !fs::symlink_metadata(&entry)?.file_type().is_symlink(),
            "Toolbox Skill source is linked"
        );
        let root = self.root.canonicalize()?;
        let directory = directory.canonicalize()?;
        ensure!(
            directory.starts_with(&root),
            "Toolbox Skill left its managed root"
        );
        let entry = entry.canonicalize()?;
        ensure!(
            entry.starts_with(&directory),
            "Toolbox Skill entry left its directory"
        );
        let metadata = fs::metadata(&entry)?;
        ensure!(
            metadata.is_file() && metadata.len() <= 1024 * 1024,
            "Toolbox Skill is not readable"
        );
        Ok(fs::read_to_string(entry)?)
    }

    pub fn index(
        &self,
        names: impl IntoIterator<Item = impl AsRef<str>>,
    ) -> (Vec<SkillIndexEntry>, Vec<String>) {
        let mut entries = Vec::new();
        let mut omitted = Vec::new();
        for name in names
            .into_iter()
            .map(|name| name.as_ref().to_owned())
            .collect::<BTreeSet<_>>()
        {
            match self
                .entry_path(&name)
                .and_then(|path| read_frontmatter(&path, &name))
            {
                Ok(desc) => entries.push(SkillIndexEntry { name, desc }),
                Err(error) => omitted.push(format!("{name}: {error:#}")),
            }
        }
        (entries, omitted)
    }

    pub fn index_json(&self, entries: &[SkillIndexEntry]) -> Result<String> {
        let root = self
            .root
            .to_str()
            .context("managed Skills root is not UTF-8")?;
        Ok(serde_json::to_string(&SkillIndex {
            root,
            skills: entries,
        })?)
    }

    pub fn list_toolbox(&self, connection: &Connection) -> Result<Vec<ToolboxSkillView>> {
        let mut views = Vec::new();
        for name in TOOLBOX_SKILLS {
            let member_ids = toolbox_member_ids(connection, name)?;
            let version = toolbox_members_version(&member_ids)?;
            let (description, source_error) = match self
                .entry_path(name)
                .and_then(|path| read_frontmatter(&path, name))
            {
                Ok(description) => (Some(description), None),
                Err(error) => (None, Some(format!("{error:#}"))),
            };
            views.push(ToolboxSkillView {
                name: name.to_owned(),
                description,
                member_ids,
                version,
                source_error,
            });
        }
        Ok(views)
    }
}

pub fn configured_toolbox_names(connection: &Connection, agent_id: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT skill_name FROM member_toolbox_skill WHERE agent_id = ?1 ORDER BY skill_name",
    )?;
    Ok(statement
        .query_map([agent_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn set_toolbox_members(
    database: &mut Database,
    envelope: &CommandEnvelope<SetToolboxMembersCommand>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |transaction| {
        let command = &envelope.payload;
        if !matches!(envelope.actor, ActorRef::User { .. })
            || envelope.camp_id.is_some()
            || envelope.execution_epoch.is_some()
            || !TOOLBOX_SKILLS.contains(&command.skill_name.as_str())
        {
            return Ok(CommandHandlerResult::rejected("toolbox.invalid_request", json!({})));
        }
        let current = toolbox_member_ids(transaction, &command.skill_name)?;
        let current_version = toolbox_members_version(&current)?;
        if current_version != command.expected_version {
            return Ok(CommandHandlerResult::rejected(
                "toolbox.members.conflict",
                json!({"version": current_version}),
            ));
        }
        let member_ids = command.member_ids.iter().cloned().collect::<BTreeSet<_>>();
        for agent_id in &member_ids {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_profile WHERE id = ?1 AND profile_status <> 'removed')",
                [agent_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Ok(CommandHandlerResult::rejected(
                    "toolbox.member_unavailable",
                    json!({"agentId": agent_id}),
                ));
            }
        }
        transaction.execute(
            "DELETE FROM member_toolbox_skill WHERE skill_name = ?1",
            [&command.skill_name],
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        for agent_id in &member_ids {
            transaction.execute(
                "INSERT INTO member_toolbox_skill(agent_id, skill_name, updated_at) VALUES (?1, ?2, ?3)",
                params![agent_id, command.skill_name, now],
            )?;
        }
        let member_ids = member_ids.into_iter().collect::<Vec<_>>();
        Ok(CommandHandlerResult::applied(
            "toolbox.members.updated",
            json!({
                "skillName": command.skill_name,
                "memberIds": member_ids,
                "version": toolbox_members_version(&member_ids)?,
            }),
            None,
        ))
    })
}

fn toolbox_member_ids(connection: &Connection, name: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT agent_id FROM member_toolbox_skill WHERE skill_name = ?1 ORDER BY agent_id",
    )?;
    Ok(statement
        .query_map([name], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn toolbox_members_version(member_ids: &[String]) -> Result<String> {
    canonical_json_digest(&json!(member_ids))
}

pub fn read_frontmatter(path: &Path, expected_name: &str) -> Result<String> {
    let content =
        fs::read_to_string(path).with_context(|| format!("cannot read {}", path.display()))?;
    let mut lines = content.split_inclusive('\n');
    ensure!(
        lines
            .next()
            .is_some_and(|line| line.trim_end_matches(['\r', '\n']) == "---"),
        "Skill frontmatter is missing"
    );
    let mut yaml = String::new();
    let mut terminated = false;
    for line in lines {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            terminated = true;
            break;
        }
        yaml.push_str(line);
    }
    ensure!(terminated, "Skill frontmatter is unterminated");
    let metadata: SkillFrontmatter =
        serde_yaml::from_str(&yaml).context("Skill frontmatter YAML is invalid")?;
    ensure!(
        metadata.name.as_deref() == Some(expected_name),
        "Skill frontmatter name differs from its managed directory"
    );
    ensure!(
        !metadata.description.is_empty(),
        "Skill frontmatter description is empty"
    );
    Ok(metadata.description)
}

fn sync_directory(source: &Path, target: &Path) -> Result<()> {
    if let Ok(metadata) = fs::symlink_metadata(target) {
        ensure!(
            metadata.is_dir() && !metadata.file_type().is_symlink(),
            "managed Skill directory is not a real directory"
        );
    } else {
        prepare_private_directory(target)?;
    }
    for child in fs::read_dir(source)? {
        let child = child?;
        let metadata = child.file_type()?;
        ensure!(
            !metadata.is_symlink(),
            "bundled Skill resource contains a symlink"
        );
        let destination = target.join(child.file_name());
        if metadata.is_dir() {
            sync_directory(&child.path(), &destination)?;
        } else if metadata.is_file() {
            let expected = fs::read(child.path())?;
            if fs::symlink_metadata(&destination)
                .is_ok_and(|current| current.is_file() && !current.file_type().is_symlink())
                && fs::read(&destination).is_ok_and(|current| current == expected)
            {
                continue;
            }
            let temporary = target.join(format!(".rovai-managed-{}", Uuid::new_v4()));
            fs::write(&temporary, &expected)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = fs::metadata(child.path())?.permissions().mode() & 0o777;
                fs::set_permissions(&temporary, fs::Permissions::from_mode(mode))?;
            }
            fs::rename(&temporary, &destination)?;
        } else {
            anyhow::bail!("bundled Skill resource has an unsupported file type");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "extended-tests")]
    fn insert_member(connection: &Connection, id: &str, order: i64) {
        connection.execute(
            "INSERT INTO agent_profile(id, slug, handle, display_name, avatar_ref, team_role, professional_responsibilities, personality_traits_json, working_principles, growth_topic, default_capabilities_json, accent, runtime_enabled, profile_status, member_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000', 'role', 'responsibility', '[]', 'principles', 'growth', '[]', '#123456', 0, 'away', ?5, '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')",
            params![id, id, id, id, order],
        ).unwrap();
    }

    #[cfg(feature = "extended-tests")]
    #[test]
    fn stale_toolbox_command_preserves_new_members_default_and_replays_rejection() {
        let directory = std::env::temp_dir().join(format!("rovai-toolbox-cas-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        insert_member(database.connection(), "agent-first", 1);
        let initial = toolbox_member_ids(database.connection(), "member-studio").unwrap();
        let version = toolbox_members_version(&initial).unwrap();
        insert_member(database.connection(), "agent-second", 2);
        let with_new_member = toolbox_member_ids(database.connection(), "member-studio").unwrap();
        assert!(with_new_member.contains(&"agent-second".to_string()));
        let envelope = CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: SetToolboxMembersCommand {
                skill_name: "member-studio".to_string(),
                member_ids: Vec::new(),
                expected_version: version,
            },
        };
        let first = set_toolbox_members(&mut database, &envelope).unwrap();
        assert_eq!(first.result.code, "toolbox.members.conflict");
        let replay = set_toolbox_members(&mut database, &envelope).unwrap();
        assert!(replay.replayed);
        assert_eq!(
            toolbox_member_ids(database.connection(), "member-studio").unwrap(),
            with_new_member,
        );
        drop(database);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn frontmatter_preserves_yaml_scalar_value_in_model_index() {
        let root = std::env::temp_dir().join(format!("rovai-frontmatter-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("SKILL.md");
        fs::write(
            &path,
            "---\nname: campfire\ndescription: >-\n  中文 \\\"quoted\\\"\n  next \\\\ path\n---\n# Body\n",
        )
        .unwrap();
        assert_eq!(
            read_frontmatter(&path, "campfire").unwrap(),
            "中文 \\\"quoted\\\" next \\\\ path"
        );
        fs::write(
            &path,
            "---\nname: campfire\ndescription: |\n  第一行\n  second \\\\ line\n---\n",
        )
        .unwrap();
        assert_eq!(
            read_frontmatter(&path, "campfire").unwrap(),
            "第一行\nsecond \\\\ line\n"
        );
        assert!(read_frontmatter(&path, "review-duo").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn synchronization_repairs_owned_files_and_keeps_unknown_content() {
        let root = std::env::temp_dir().join(format!("rovai-managed-skills-{}", Uuid::new_v4()));
        let resources = root.join("resources");
        let managed_root = root.join("instance").join("skills");
        for name in PUBLISHED_SKILLS {
            let directory = resources.join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: '{name} description'\n---\n"),
            )
            .unwrap();
        }
        let managed = ManagedSkills::new(managed_root.clone(), resources).unwrap();
        managed.sync().unwrap();
        fs::write(managed_root.join("campfire").join("SKILL.md"), "modified").unwrap();
        fs::write(managed_root.join("keep.txt"), "user data").unwrap();
        managed.sync().unwrap();
        assert_eq!(
            read_frontmatter(&managed_root.join("campfire").join("SKILL.md"), "campfire").unwrap(),
            "campfire description"
        );
        assert_eq!(
            fs::read_to_string(managed_root.join("keep.txt")).unwrap(),
            "user data"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
