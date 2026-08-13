use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

const PINNED_THIRD_PARTY_SKILLS: &[(&str, &str)] = &[
    ("diagnosing-bugs", "DIAGNOSING_BUGS_FILES"),
    ("tasteful-ui", "TASTEFUL_UI_FILES"),
    ("tdd", "TDD_FILES"),
    ("writing-for-agents", "WRITING_FOR_AGENTS_FILES"),
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let output_path = PathBuf::from(env::var("OUT_DIR")?).join("third_party_bundled_files.rs");
    let mut output = fs::File::create(output_path)?;
    for (skill_name, const_name) in PINNED_THIRD_PARTY_SKILLS {
        write_bundled_skill(&manifest_dir, &mut output, skill_name, const_name)?;
    }
    Ok(())
}

fn write_bundled_skill(
    manifest_dir: &Path,
    output: &mut fs::File,
    skill_name: &str,
    const_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let skill_root = manifest_dir.join("../../skills").join(skill_name);
    let mut files = Vec::new();
    collect_files(&skill_root, &skill_root, &mut files)?;
    files.sort();

    if files.is_empty() {
        return Err(format!("{skill_name} bundled Skill source is empty").into());
    }

    writeln!(output, "const {const_name}: &[(&str, &str, u32)] = &[")?;
    for relative in files {
        let source_suffix = format!("/../../skills/{skill_name}/{relative}");
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
    println!("cargo:rerun-if-changed={}", skill_root.display());
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
