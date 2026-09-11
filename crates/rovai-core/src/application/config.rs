use super::*;

/// Optional Skill cleanup input. A malformed Desktop cleanup option degrades
/// Skills during its existing initialization, not the Core authority startup.
#[derive(Clone, Debug)]
pub struct RemovedSkillProjectRoots(std::result::Result<Vec<String>, String>);

impl Default for RemovedSkillProjectRoots {
    fn default() -> Self {
        Self(Ok(Vec::new()))
    }
}

impl RemovedSkillProjectRoots {
    pub fn from_paths(paths: impl IntoIterator<Item = String>) -> Self {
        Self::from_legacy_args(
            paths
                .into_iter()
                .flat_map(|path| ["--removed-skill-project-root".to_string(), path]),
        )
    }

    fn from_legacy_args(args: impl IntoIterator<Item = String>) -> Self {
        Self(parse_removed_skill_project_roots_from(args).map_err(|error| format!("{error:#}")))
    }

    pub(super) fn get(&self) -> Result<&[String]> {
        self.0
            .as_deref()
            .map_err(|message| anyhow::anyhow!("{message}"))
    }
}

/// Explicit paths and startup policy for one Core owner. Constructed by the host,
/// never inferred from the embedding process's command line by the runtime.
#[derive(Clone, Debug)]
pub struct CoreConfig {
    pub data_dir: PathBuf,
    pub skill_library_root: PathBuf,
    pub runtime_camp_files_root: PathBuf,
    pub mcp_config_path: Option<PathBuf>,
    pub require_existing_authority: bool,
    pub automation_scheduler_control: Option<AutomationSchedulerControl>,
    pub removed_skill_project_roots: RemovedSkillProjectRoots,
}

impl CoreConfig {
    /// Compatibility parser for the Desktop sidecar adapter. Hosts can instead
    /// construct the configuration directly; both paths undergo validation.
    pub fn from_legacy_args(args: impl IntoIterator<Item = String>) -> Result<Self> {
        let args: Vec<String> = args.into_iter().collect();
        let skill_library_root = match parse_skill_library_root_from(args.clone())? {
            SkillLibraryRootSelection::Explicit(root) => root,
            SkillLibraryRootSelection::Default => SkillLibraryService::default_root()?,
        };
        let config = Self {
            data_dir: parse_data_dir_from(args.clone())?,
            skill_library_root,
            runtime_camp_files_root: parse_runtime_camp_files_root_from(args.clone())?,
            mcp_config_path: parse_mcp_config_path_from(args.clone())?,
            require_existing_authority: args
                .iter()
                .any(|arg| arg == "--require-existing-authority"),
            automation_scheduler_control: parse_automation_scheduler_control_from(args.clone())?,
            removed_skill_project_roots: RemovedSkillProjectRoots::from_legacy_args(args),
        };
        config.validate()?;
        Ok(config)
    }

    pub(super) fn validate(&self) -> Result<()> {
        if !self.data_dir.is_absolute() {
            anyhow::bail!("Core data_dir must be absolute; daily userData is never inferred");
        }
        for (name, path) in [
            ("skill_library_root", &self.skill_library_root),
            ("runtime_camp_files_root", &self.runtime_camp_files_root),
        ] {
            if !path.is_absolute()
                || path.components().any(|component| {
                    matches!(
                        component,
                        std::path::Component::CurDir | std::path::Component::ParentDir
                    )
                })
            {
                anyhow::bail!("Core {name} must be a normalized absolute path");
            }
        }
        if self
            .mcp_config_path
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
        {
            anyhow::bail!("Core mcp_config_path must be absolute");
        }
        Ok(())
    }
}
