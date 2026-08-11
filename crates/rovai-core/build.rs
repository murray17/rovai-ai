use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let skill_root = manifest_dir.join("../../skills/tasteful-ui");
    let mut files = Vec::new();
    collect_files(&skill_root, &skill_root, &mut files)?;
    files.sort();

    if files.is_empty() {
        return Err("tasteful-ui bundled Skill source is empty".into());
    }

    let output_path = PathBuf::from(env::var("OUT_DIR")?).join("tasteful_ui_bundled_files.rs");
    let mut output = fs::File::create(output_path)?;
    writeln!(output, "const TASTEFUL_UI_FILES: &[(&str, &str, u32)] = &[")?;
    for relative in files {
        let source_suffix = format!("/../../skills/tasteful-ui/{relative}");
        writeln!(
            output,
            "    ({relative:?}, include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), {source_suffix:?})), 0o644),"
        )?;
        println!(
            "cargo:rerun-if-changed={}",
            skill_root.join(&relative).display()
        );
    }
    writeln!(output, "];")?;
    Ok(())
}

fn collect_files(root: &Path, directory: &Path, files: &mut Vec<String>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "bundled Skill source must not contain symlinks: {}",
                    path.display()
                ),
            ));
        }
        if file_type.is_dir() {
            collect_files(root, &path, files)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("unsupported bundled Skill node: {}", path.display()),
            ));
        }
        let relative = path.strip_prefix(root).map_err(io::Error::other)?;
        let relative = relative
            .to_str()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "non-UTF-8 Skill path"))?
            .replace(std::path::MAIN_SEPARATOR, "/");
        files.push(relative);
    }
    Ok(())
}
