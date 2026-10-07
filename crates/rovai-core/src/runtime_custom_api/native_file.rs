//! Resolve native paths for read-only connection identity.
use anyhow::{Result, ensure};
use std::path::{Path, PathBuf};

pub(crate) fn target(path: &Path) -> Result<PathBuf> {
    fn resolve(path: &Path, links: usize) -> Result<PathBuf> {
        ensure!(links < 40, "原生配置符号链接循环或层级过深。");
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                let link = std::fs::read_link(path)?;
                let next = if link.is_absolute() {
                    link
                } else {
                    path.parent().unwrap_or(Path::new(".")).join(link)
                };
                resolve(&next, links + 1)
            }
            Ok(_) => Ok(std::fs::canonicalize(path)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let parent = path
                    .parent()
                    .ok_or_else(|| anyhow::anyhow!("原生配置没有可写目标目录。"))?;
                let name = path
                    .file_name()
                    .ok_or_else(|| anyhow::anyhow!("原生配置目标路径无效。"))?;
                Ok(resolve(parent, links)?.join(name))
            }
            Err(error) => Err(error.into()),
        }
    }
    resolve(path, 0).map_err(|_| anyhow::anyhow!("无法解析原生配置目标：{}", path.display()))
}
