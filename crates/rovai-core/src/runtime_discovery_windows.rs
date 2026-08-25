use std::{
    collections::BTreeMap,
    env,
    ffi::{OsStr, OsString},
    fs::{self, File},
    io::Read,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::MetadataExt,
    },
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use windows_sys::Win32::{
    Foundation::{ERROR_SUCCESS, TRUE},
    Globalization::{CSTR_EQUAL, CompareStringOrdinal},
    Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT,
    System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_EXPAND_SZ, REG_SZ, RRF_NOEXPAND,
        RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RRF_ZEROONFAILURE, RegGetValueW,
    },
};

const MAX_REGISTRY_PATH_BYTES: u32 = 64 * 1024;
const MAX_EXPANDED_PATH_UTF16_UNITS: usize = 32_767;
const MAX_ENVIRONMENT_EXPANSION_PASSES: usize = 8;
const MAX_CODEX_SHIM_BYTES: u64 = 32 * 1024;
const MAX_PACKAGE_JSON_BYTES: u64 = 64 * 1024;
const CODEX_ENTRYPOINT_SUFFIX: &str = r"\node_modules\@openai\codex\bin\codex.js";
const CODEX_PLATFORM_PACKAGE: &str = "@openai/codex-win32-x64";
const CODEX_PLATFORM_DEPENDENCY_PREFIX: &str = "npm:@openai/codex@";
const CODEX_PLATFORM_VERSION_SUFFIX: &str = "-win32-x64";
const CODEX_PLATFORM_EXECUTABLE: &str = "vendor/x86_64-pc-windows-msvc/bin/codex.exe";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PackageManagerShimKind {
    Npm,
    Pnpm,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedCodexCmdShim {
    pub(crate) executable: PathBuf,
    pub(crate) package_manager: PackageManagerShimKind,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WindowsRegistryPathValues {
    pub(crate) user: Option<OsString>,
    pub(crate) machine: Option<OsString>,
}

#[derive(Debug, Deserialize)]
struct CodexMainPackage {
    name: String,
    version: String,
    bin: BTreeMap<String, String>,
    #[serde(rename = "optionalDependencies")]
    optional_dependencies: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct CodexPlatformPackage {
    name: String,
    version: String,
    os: Vec<String>,
    cpu: Vec<String>,
}

pub(crate) fn read_registry_path_values() -> WindowsRegistryPathValues {
    WindowsRegistryPathValues {
        user: read_registry_string(HKEY_CURRENT_USER, "Environment", "Path"),
        machine: read_registry_string(
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
            "Path",
        ),
    }
}

pub(crate) fn registry_path_directories(
    value: Option<&OsStr>,
    environment: &[(OsString, OsString)],
) -> Vec<PathBuf> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    env::split_paths(value)
        .filter_map(|path| expand_environment_variables(path.as_os_str(), environment))
        .flat_map(|expanded| env::split_paths(&expanded).collect::<Vec<_>>())
        .filter(|path| {
            !path.as_os_str().is_empty()
                && path.is_absolute()
                && !path.as_os_str().to_string_lossy().contains('%')
                && path.is_dir()
        })
        .filter_map(|path| path.canonicalize().ok())
        .collect()
}

pub(crate) fn paths_equal(left: &Path, right: &Path) -> bool {
    os_strings_equal(left.as_os_str(), right.as_os_str())
}

pub(crate) fn is_cmd_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| os_strings_equal(extension, OsStr::new("cmd")))
}

pub(crate) fn is_codex_cmd_path(path: &Path) -> bool {
    is_cmd_path(path)
        && path
            .file_name()
            .is_some_and(|name| os_strings_equal(name, OsStr::new("codex.cmd")))
}

/// Resolve a known npm/pnpm Codex command shim to the native Windows binary.
///
/// The shim is never executed. Every path-bearing layer is bounded and must
/// remain under the canonical shim directory, and the final executable is
/// derived from the verified package layout instead of script commands.
pub(crate) fn inspect_codex_cmd_shim(shim_path: &Path) -> Option<ResolvedCodexCmdShim> {
    if !is_codex_cmd_path(shim_path) {
        return None;
    }
    let shim_metadata = fs::symlink_metadata(shim_path).ok()?;
    if !shim_metadata.is_file()
        || shim_metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return None;
    }
    let shim_root = shim_path.parent()?.canonicalize().ok()?;
    let shim = read_bounded_utf8(shim_path, MAX_CODEX_SHIM_BYTES)?;
    let shim = shim.strip_prefix('\u{feff}').unwrap_or(&shim);
    if shim.contains('\0') {
        return None;
    }
    let normalized = shim.replace("\r\n", "\n").replace('\r', "\n");
    let target = unique_codex_entrypoint_target(&normalized)?;
    let package_manager = known_package_manager_shim_template(&normalized, &target)?;
    let entrypoint = resolve_shim_entrypoint(&shim_root, &target)?;
    if !path_is_within(&entrypoint, &shim_root) || !entrypoint.is_file() {
        return None;
    }
    let package_root = codex_package_root(&entrypoint)?;
    if !path_is_within(package_root, &shim_root) {
        return None;
    }
    let package = read_json_bounded::<CodexMainPackage>(
        &package_root.join("package.json"),
        MAX_PACKAGE_JSON_BYTES,
    )?;
    if !valid_main_package(&package) {
        return None;
    }

    Some(ResolvedCodexCmdShim {
        executable: resolve_platform_executable(package_root, &shim_root, &package)?,
        package_manager,
    })
}

#[cfg(test)]
pub(crate) fn resolve_codex_cmd_shim(shim_path: &Path) -> Option<PathBuf> {
    inspect_codex_cmd_shim(shim_path).map(|resolved| resolved.executable)
}

pub(crate) fn classify_package_manager_cmd_shim(
    shim_path: &Path,
) -> Option<PackageManagerShimKind> {
    if !is_cmd_path(shim_path) {
        return None;
    }
    let shim = read_bounded_utf8(shim_path, MAX_CODEX_SHIM_BYTES)?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let target = unique_node_entrypoint_target(&shim)?;
    known_package_manager_shim_template(&shim, &target)
}

fn read_registry_string(root: HKEY, subkey: &str, value_name: &str) -> Option<OsString> {
    let subkey = wide_null(subkey);
    let value_name = wide_null(value_name);
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND | RRF_ZEROONFAILURE;
    let mut value_type = 0;
    let mut byte_count = 0;
    // SAFETY: The root handles are predefined, both strings are NUL-terminated,
    // and the first call intentionally supplies no output buffer to obtain size.
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            &mut value_type,
            std::ptr::null_mut(),
            &mut byte_count,
        )
    };
    if status != ERROR_SUCCESS
        || !matches!(value_type, REG_SZ | REG_EXPAND_SZ)
        || byte_count == 0
        || byte_count > MAX_REGISTRY_PATH_BYTES
        || byte_count % 2 != 0
    {
        return None;
    }

    let mut buffer = vec![0_u16; byte_count as usize / 2 + 1];
    let mut actual_bytes = byte_count;
    // SAFETY: The buffer is sized from the successful bounded query above and
    // remains alive and writable for the duration of the API call.
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            &mut value_type,
            buffer.as_mut_ptr().cast(),
            &mut actual_bytes,
        )
    };
    if status != ERROR_SUCCESS
        || !matches!(value_type, REG_SZ | REG_EXPAND_SZ)
        || actual_bytes == 0
        || actual_bytes > byte_count
        || actual_bytes % 2 != 0
    {
        return None;
    }
    buffer.truncate(actual_bytes as usize / 2);
    while buffer.last() == Some(&0) {
        buffer.pop();
    }
    if buffer.is_empty() || buffer.contains(&0) {
        return None;
    }
    Some(OsString::from_wide(&buffer))
}

fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn expand_environment_variables(
    value: &OsStr,
    environment: &[(OsString, OsString)],
) -> Option<OsString> {
    let mut current = value.to_str()?.to_owned();
    if current.encode_utf16().count() > MAX_EXPANDED_PATH_UTF16_UNITS {
        return None;
    }
    for _ in 0..MAX_ENVIRONMENT_EXPANSION_PASSES {
        if !current.contains('%') {
            return Some(OsString::from(current));
        }
        let mut expanded = String::with_capacity(current.len());
        let mut cursor = 0;
        let mut replaced = false;
        while let Some(relative_start) = current[cursor..].find('%') {
            let start = cursor + relative_start;
            expanded.push_str(&current[cursor..start]);
            let name_start = start + 1;
            let relative_end = current[name_start..].find('%')?;
            let end = name_start + relative_end;
            let name = &current[name_start..end];
            if name.is_empty() {
                return None;
            }
            let replacement = environment
                .iter()
                .find(|(key, _)| os_strings_equal(key, OsStr::new(name)))?
                .1
                .to_str()?;
            expanded.push_str(replacement);
            cursor = end + 1;
            replaced = true;
        }
        expanded.push_str(&current[cursor..]);
        if !replaced
            || expanded == current
            || expanded.encode_utf16().count() > MAX_EXPANDED_PATH_UTF16_UNITS
        {
            return None;
        }
        current = expanded;
    }
    (!current.contains('%')).then(|| OsString::from(current))
}

fn os_strings_equal(left: &OsStr, right: &OsStr) -> bool {
    let left = left.encode_wide().collect::<Vec<_>>();
    let right = right.encode_wide().collect::<Vec<_>>();
    let Ok(left_len) = i32::try_from(left.len()) else {
        return false;
    };
    let Ok(right_len) = i32::try_from(right.len()) else {
        return false;
    };
    // SAFETY: Both pointers reference immutable UTF-16 buffers for the exact
    // lengths supplied. CompareStringOrdinal does not require NUL termination.
    unsafe {
        CompareStringOrdinal(left.as_ptr(), left_len, right.as_ptr(), right_len, TRUE) == CSTR_EQUAL
    }
}

fn read_bounded_utf8(path: &Path, limit: u64) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit {
        return None;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .ok()?
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > limit {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn read_json_bounded<T: for<'de> Deserialize<'de>>(path: &Path, limit: u64) -> Option<T> {
    let text = read_bounded_utf8(path, limit)?;
    serde_json::from_str(&text).ok()
}

fn known_package_manager_shim_template(shim: &str, target: &str) -> Option<PackageManagerShimKind> {
    let npm = format!(
        concat!(
            "@ECHO off\n",
            "GOTO start\n",
            ":find_dp0\n",
            "SET dp0=%~dp0\n",
            "EXIT /b\n",
            ":start\n",
            "SETLOCAL\n",
            "CALL :find_dp0\n",
            "\n",
            "IF EXIST \"%dp0%\\node.exe\" (\n",
            "  SET \"_prog=%dp0%\\node.exe\"\n",
            ") ELSE (\n",
            "  SET \"_prog=node\"\n",
            ")\n",
            "\n",
            "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & \"%_prog%\"  \"{target}\" %*\n"
        ),
        target = target
    );
    if shim == npm {
        return Some(PackageManagerShimKind::Npm);
    }
    let pnpm = format!(
        concat!(
            "@SETLOCAL\n",
            "@IF EXIST \"%~dp0\\node.exe\" (\n",
            "  \"%~dp0\\node.exe\"  \"{target}\" %*\n",
            ") ELSE (\n",
            "  @SET PATHEXT=%PATHEXT:;.JS;=;%\n",
            "  node  \"{target}\" %*\n",
            ")\n"
        ),
        target = target
    );
    (shim == pnpm).then_some(PackageManagerShimKind::Pnpm)
}

#[cfg(test)]
fn is_known_codex_shim_template(shim: &str, target: &str) -> bool {
    known_package_manager_shim_template(shim, target).is_some()
}

fn unique_node_entrypoint_target(shim: &str) -> Option<String> {
    if !shim.matches('"').count().is_multiple_of(2) {
        return None;
    }
    let mut targets = Vec::<String>::new();
    for quoted in shim.split('"').skip(1).step_by(2) {
        let normalized = quoted.replace('/', "\\");
        let lower = normalized.to_ascii_lowercase();
        if !lower.ends_with(".js")
            || (!lower.contains(r"\node_modules\")
                && !lower.starts_with(r"%dp0%\")
                && !lower.starts_with(r"%~dp0\"))
        {
            continue;
        }
        if !targets
            .iter()
            .any(|existing| os_strings_equal(OsStr::new(existing), OsStr::new(&normalized)))
        {
            targets.push(normalized);
        }
    }
    (targets.len() == 1).then(|| targets.remove(0))
}

fn unique_codex_entrypoint_target(shim: &str) -> Option<String> {
    if !shim.matches('"').count().is_multiple_of(2) {
        return None;
    }
    let mut targets = Vec::<String>::new();
    for quoted in shim.split('"').skip(1).step_by(2) {
        let normalized = quoted.replace('/', "\\");
        if !normalized
            .to_ascii_lowercase()
            .ends_with(CODEX_ENTRYPOINT_SUFFIX)
        {
            continue;
        }
        if !targets
            .iter()
            .any(|existing| os_strings_equal(OsStr::new(existing), OsStr::new(&normalized)))
        {
            targets.push(normalized);
        }
    }
    (targets.len() == 1).then(|| targets.remove(0))
}

fn resolve_shim_entrypoint(shim_root: &Path, target: &str) -> Option<PathBuf> {
    let relative = target
        .strip_prefix(r"%dp0%\")
        .or_else(|| target.strip_prefix(r"%~dp0\"));
    let unresolved = if let Some(relative) = relative {
        let relative = Path::new(relative);
        if relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return None;
        }
        shim_root.join(relative)
    } else {
        let absolute = PathBuf::from(target);
        if target.contains('%') || !absolute.is_absolute() {
            return None;
        }
        absolute
    };
    unresolved.canonicalize().ok()
}

fn codex_package_root(entrypoint: &Path) -> Option<&Path> {
    if !entrypoint
        .file_name()
        .is_some_and(|name| os_strings_equal(name, OsStr::new("codex.js")))
    {
        return None;
    }
    let bin = entrypoint.parent()?;
    if !bin
        .file_name()
        .is_some_and(|name| os_strings_equal(name, OsStr::new("bin")))
    {
        return None;
    }
    let package = bin.parent()?;
    let scope = package.parent()?;
    let node_modules = scope.parent()?;
    if package
        .file_name()
        .is_some_and(|name| os_strings_equal(name, OsStr::new("codex")))
        && scope
            .file_name()
            .is_some_and(|name| os_strings_equal(name, OsStr::new("@openai")))
        && node_modules
            .file_name()
            .is_some_and(|name| os_strings_equal(name, OsStr::new("node_modules")))
    {
        Some(package)
    } else {
        None
    }
}

fn valid_main_package(package: &CodexMainPackage) -> bool {
    if package.name != "@openai/codex"
        || package.version.is_empty()
        || package.version.len() > 128
        || package.version.ends_with(CODEX_PLATFORM_VERSION_SUFFIX)
        || package.bin.get("codex").map(String::as_str) != Some("bin/codex.js")
    {
        return false;
    }
    let expected_dependency = format!(
        "{CODEX_PLATFORM_DEPENDENCY_PREFIX}{}{CODEX_PLATFORM_VERSION_SUFFIX}",
        package.version
    );
    package
        .optional_dependencies
        .get(CODEX_PLATFORM_PACKAGE)
        .is_some_and(|dependency| dependency == &expected_dependency)
}

fn resolve_platform_executable(
    package_root: &Path,
    shim_root: &Path,
    main_package: &CodexMainPackage,
) -> Option<PathBuf> {
    let expected_version = format!("{}{CODEX_PLATFORM_VERSION_SUFFIX}", main_package.version);
    let mut current = Some(package_root);
    while let Some(directory) = current {
        if !path_is_within(directory, shim_root) {
            return None;
        }
        let platform_package = directory
            .join("node_modules")
            .join("@openai")
            .join("codex-win32-x64");
        if let Ok(platform_package) = platform_package.canonicalize() {
            if !path_is_within(&platform_package, shim_root) {
                return None;
            }
            let package = read_json_bounded::<CodexPlatformPackage>(
                &platform_package.join("package.json"),
                MAX_PACKAGE_JSON_BYTES,
            )?;
            if package.name != "@openai/codex"
                || package.version != expected_version
                || package.os != ["win32"]
                || package.cpu != ["x64"]
            {
                return None;
            }
            let executable = platform_package
                .join(CODEX_PLATFORM_EXECUTABLE)
                .canonicalize()
                .ok()?;
            if path_is_within(&executable, &platform_package)
                && executable
                    .extension()
                    .is_some_and(|extension| os_strings_equal(extension, OsStr::new("exe")))
                && executable.is_file()
            {
                return Some(executable);
            }
            return None;
        }
        if paths_equal(directory, shim_root) {
            break;
        }
        current = directory.parent();
    }
    None
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let mut path_components = path.components();
    for root_component in root.components() {
        let Some(path_component) = path_components.next() else {
            return false;
        };
        if !os_strings_equal(path_component.as_os_str(), root_component.as_os_str()) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    const VERSION: &str = "0.149.1";

    struct CodexPackageFixture {
        entrypoint: PathBuf,
        main_package: PathBuf,
        executable: PathBuf,
    }

    fn temporary_directory(label: &str) -> PathBuf {
        env::temp_dir().join(format!("rovai-{label}-{}", Uuid::new_v4()))
    }

    fn install_package_fixture(shim_root: &Path, package_relative: &Path) -> CodexPackageFixture {
        let main_package = shim_root.join(package_relative);
        let entrypoint = main_package.join("bin/codex.js");
        fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
        fs::write(&entrypoint, b"#!/usr/bin/env node\n").unwrap();
        write_main_package(&main_package, "@openai/codex");

        let node_modules = main_package.parent().unwrap().parent().unwrap();
        let platform_package = node_modules.join("@openai/codex-win32-x64");
        let executable = platform_package.join(CODEX_PLATFORM_EXECUTABLE);
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(
            platform_package.join("package.json"),
            serde_json::to_vec_pretty(&json!({
                "name": "@openai/codex",
                "version": format!("{VERSION}-win32-x64"),
                "os": ["win32"],
                "cpu": ["x64"]
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(&executable, b"native codex fixture").unwrap();

        CodexPackageFixture {
            entrypoint,
            main_package,
            executable,
        }
    }

    fn write_main_package(package_root: &Path, name: &str) {
        fs::write(
            package_root.join("package.json"),
            serde_json::to_vec_pretty(&json!({
                "name": name,
                "version": VERSION,
                "bin": { "codex": "bin/codex.js" },
                "optionalDependencies": {
                    "@openai/codex-win32-x64": format!(
                        "npm:@openai/codex@{VERSION}-win32-x64"
                    )
                }
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn windows_relative(path: &Path) -> String {
        path.to_string_lossy().replace('/', "\\")
    }

    fn npm_shim(target: &str) -> String {
        format!(
            concat!(
                "@ECHO off\r\n",
                "GOTO start\r\n",
                ":find_dp0\r\n",
                "SET dp0=%~dp0\r\n",
                "EXIT /b\r\n",
                ":start\r\n",
                "SETLOCAL\r\n",
                "CALL :find_dp0\r\n",
                "\r\n",
                "IF EXIST \"%dp0%\\node.exe\" (\r\n",
                "  SET \"_prog=%dp0%\\node.exe\"\r\n",
                ") ELSE (\r\n",
                "  SET \"_prog=node\"\r\n",
                ")\r\n",
                "\r\n",
                "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & \"%_prog%\"  \"{target}\" %*\r\n"
            ),
            target = target
        )
    }

    fn pnpm_shim(target: &str) -> String {
        format!(
            concat!(
                "@SETLOCAL\r\n",
                "@IF EXIST \"%~dp0\\node.exe\" (\r\n",
                "  \"%~dp0\\node.exe\"  \"{target}\" %*\r\n",
                ") ELSE (\r\n",
                "  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n",
                "  node  \"{target}\" %*\r\n",
                ")\r\n"
            ),
            target = target
        )
    }

    #[test]
    fn npm_cmd_shim_resolves_to_real_codex_executable() {
        let root = temporary_directory("npm-codex-shim");
        fs::create_dir_all(&root).unwrap();
        let package_relative = Path::new("node_modules/@openai/codex");
        let fixture = install_package_fixture(&root, package_relative);
        let shim = root.join("codex.cmd");
        let target = format!(
            r"%dp0%\{}",
            windows_relative(fixture.entrypoint.strip_prefix(&root).unwrap())
        );
        fs::write(&shim, npm_shim(&target)).unwrap();

        assert_eq!(
            resolve_codex_cmd_shim(&shim),
            Some(fixture.executable.canonicalize().unwrap())
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pnpm_global_cmd_shim_resolves_to_real_codex_executable() {
        let root = temporary_directory("pnpm-codex-shim");
        fs::create_dir_all(&root).unwrap();
        let package_relative =
            Path::new("global/5/.pnpm/@openai+codex@0.149.1/node_modules/@openai/codex");
        let fixture = install_package_fixture(&root, package_relative);
        let shim = root.join("codex.cmd");
        let target = format!(
            r"%~dp0\{}",
            windows_relative(fixture.entrypoint.strip_prefix(&root).unwrap())
        );
        let content = pnpm_shim(&target);
        fs::write(&shim, &content).unwrap();

        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
        let parsed_target = unique_codex_entrypoint_target(&normalized).unwrap();
        assert!(is_known_codex_shim_template(&normalized, &parsed_target));
        let shim_root = root.canonicalize().unwrap();
        let entrypoint = resolve_shim_entrypoint(&shim_root, &parsed_target).unwrap();
        let package_root = codex_package_root(&entrypoint).unwrap();
        let package = read_json_bounded::<CodexMainPackage>(
            &package_root.join("package.json"),
            MAX_PACKAGE_JSON_BYTES,
        )
        .unwrap();
        assert!(valid_main_package(&package));
        assert_eq!(
            resolve_platform_executable(package_root, &shim_root, &package),
            Some(fixture.executable.canonicalize().unwrap())
        );

        assert_eq!(
            resolve_codex_cmd_shim(&shim),
            Some(fixture.executable.canonicalize().unwrap())
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn codex_cmd_shim_rejects_missing_entrypoint_and_platform_binary() {
        let root = temporary_directory("missing-codex-shim-target");
        fs::create_dir_all(&root).unwrap();
        let package_relative = Path::new("node_modules/@openai/codex");
        let fixture = install_package_fixture(&root, package_relative);
        let shim = root.join("codex.cmd");
        let target = format!(
            r"%dp0%\{}",
            windows_relative(fixture.entrypoint.strip_prefix(&root).unwrap())
        );
        fs::write(&shim, npm_shim(&target)).unwrap();

        fs::remove_file(&fixture.entrypoint).unwrap();
        assert_eq!(resolve_codex_cmd_shim(&shim), None);
        fs::write(&fixture.entrypoint, b"#!/usr/bin/env node\n").unwrap();
        fs::remove_file(&fixture.executable).unwrap();
        assert_eq!(resolve_codex_cmd_shim(&shim), None);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn codex_cmd_shim_rejects_escape_unknown_package_and_malformed_content() {
        let parent = temporary_directory("untrusted-codex-shim");
        let root = parent.join("npm");
        let outside = parent.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let outside_fixture =
            install_package_fixture(&outside, Path::new("node_modules/@openai/codex"));
        let shim = root.join("codex.cmd");
        fs::write(
            &shim,
            npm_shim(&windows_relative(&outside_fixture.entrypoint)),
        )
        .unwrap();
        assert_eq!(resolve_codex_cmd_shim(&shim), None, "escape must fail");

        let local_fixture = install_package_fixture(&root, Path::new("node_modules/@openai/codex"));
        let target = format!(
            r"%dp0%\{}",
            windows_relative(local_fixture.entrypoint.strip_prefix(&root).unwrap())
        );
        fs::write(&shim, npm_shim(&target)).unwrap();
        write_main_package(&local_fixture.main_package, "@example/not-codex");
        assert_eq!(
            resolve_codex_cmd_shim(&shim),
            None,
            "unknown package must fail"
        );

        fs::write(&shim, format!("@node \"{target}\" %*\r\n")).unwrap();
        assert_eq!(
            resolve_codex_cmd_shim(&shim),
            None,
            "unknown shim structure must fail"
        );

        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn cmd_content_cannot_redirect_runtime_to_an_arbitrary_executable() {
        let root = temporary_directory("codex-shim-arbitrary-command");
        fs::create_dir_all(&root).unwrap();
        let fixture = install_package_fixture(&root, Path::new("node_modules/@openai/codex"));
        let arbitrary = root.join("arbitrary.exe");
        fs::write(&arbitrary, b"untrusted executable").unwrap();
        let target = format!(
            r"%dp0%\{}",
            windows_relative(fixture.entrypoint.strip_prefix(&root).unwrap())
        );
        let content = npm_shim(&target).replacen(
            "IF EXIST \"%dp0%\\node.exe\" (",
            &format!(
                "\"{}\"\r\nIF EXIST \"%dp0%\\node.exe\" (",
                windows_relative(&arbitrary)
            ),
            1,
        );
        let shim = root.join("codex.cmd");
        fs::write(&shim, content).unwrap();

        assert_eq!(resolve_codex_cmd_shim(&shim), None);
        assert_ne!(
            fixture.executable.canonicalize().unwrap(),
            arbitrary.canonicalize().unwrap()
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registry_paths_expand_variables_and_ignore_invalid_items() {
        let root = temporary_directory("registry-path-expansion");
        let local_bin = root.join("Local/bin");
        let profile_bin = root.join("Profile/tools");
        fs::create_dir_all(&local_bin).unwrap();
        fs::create_dir_all(&profile_bin).unwrap();
        let environment = vec![
            (
                OsString::from("LOCALAPPDATA"),
                root.join("Local").into_os_string(),
            ),
            (
                OsString::from("UserProfile"),
                root.join("Profile").into_os_string(),
            ),
        ];
        let value = OsString::from(
            r"%LOCALAPPDATA%\bin;%userprofile%\tools;%UNKNOWN%\bin;relative;Z:\missing",
        );

        let directories = registry_path_directories(Some(&value), &environment);
        assert_eq!(
            directories,
            [
                local_bin.canonicalize().unwrap(),
                profile_bin.canonicalize().unwrap()
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_path_comparison_is_case_insensitive() {
        assert!(paths_equal(
            Path::new(r"C:\Users\Example\Codex\bin"),
            Path::new(r"c:\users\example\codex\BIN")
        ));
        assert!(!paths_equal(
            Path::new(r"C:\Users\Example\Codex\bin"),
            Path::new(r"C:\Users\Example\Other\bin")
        ));
    }
}
