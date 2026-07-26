use std::path::PathBuf;

pub const PRODUCT_NAME: &str = "Rovai-ai";
pub const LEGACY_PRODUCT_NAMES: [&str; 3] = ["Horizonward", "Horizonward AI", "Lumen AI"];

pub fn preferred_or_existing_legacy_paths(
    preferred: PathBuf,
    legacy_paths: impl IntoIterator<Item = PathBuf>,
) -> PathBuf {
    if preferred.exists() {
        return preferred;
    }
    legacy_paths
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or(preferred)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn uses_legacy_path_only_when_preferred_path_does_not_exist() {
        let root = std::env::temp_dir().join(format!("rovai-brand-path-{}", Uuid::new_v4()));
        let preferred = root.join("preferred");
        let recent_legacy = root.join("recent-legacy");
        let oldest_legacy = root.join("oldest-legacy");
        fs::create_dir_all(&recent_legacy).unwrap();
        fs::create_dir_all(&oldest_legacy).unwrap();

        assert_eq!(
            preferred_or_existing_legacy_paths(
                preferred.clone(),
                [recent_legacy.clone(), oldest_legacy.clone()]
            ),
            recent_legacy
        );

        fs::create_dir_all(&preferred).unwrap();
        assert_eq!(
            preferred_or_existing_legacy_paths(
                preferred.clone(),
                [root.join("recent-legacy"), root.join("oldest-legacy")]
            ),
            preferred
        );

        fs::remove_dir_all(root).unwrap();
    }
}
