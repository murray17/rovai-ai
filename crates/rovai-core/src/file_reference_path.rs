use anyhow::{Result, ensure};
use std::path::PathBuf;

// Resolve the path portion only. The production TS reference parser remains the
// presentation owner for line/heading targets; Core validates the original source.
pub fn reference_path(raw: &str, base: &std::path::Path) -> Result<PathBuf> {
    ensure!(
        raw.len() <= 16_384 && !raw.contains(['\0', '\r', '\n']),
        "source_not_authorized"
    );
    let mut raw = raw.trim();
    for (left, right) in [
        ('`', '`'),
        ('"', '"'),
        ('\'', '\''),
        ('(', ')'),
        ('[', ']'),
        ('{', '}'),
        ('<', '>'),
    ] {
        if let Some(inner) = raw.strip_prefix(left).and_then(|s| s.strip_suffix(right)) {
            raw = inner;
            break;
        }
    }
    let path = raw.split(['#', '?']).next().unwrap_or_default();
    let path = if raw.contains('#') {
        path
    } else {
        let positive =
            |v: &str| !v.is_empty() && !v.starts_with('0') && v.bytes().all(|b| b.is_ascii_digit());
        if let Some((prefix, suffix)) = path.rsplit_once(':') {
            if positive(suffix) {
                if let Some((file, line)) = prefix.rsplit_once(':') {
                    if positive(line) { file } else { prefix }
                } else {
                    prefix
                }
            } else if suffix
                .split_once('-')
                .is_some_and(|(a, b)| positive(a) && positive(b))
            {
                prefix
            } else {
                path
            }
        } else {
            path
        }
    };
    ensure!(!path.is_empty(), "source_not_authorized");
    // URL joining treats a Windows drive letter as a scheme. Normalize only
    // absolute local-drive references, preserving the existing one-time URL decoding.
    #[cfg(windows)]
    let windows_absolute = {
        let bytes = path.as_bytes();
        (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\'))
        .then(|| format!("file:///{}", path.replace('\\', "/")))
    };
    #[cfg(windows)]
    let path = windows_absolute.as_deref().unwrap_or(path);
    let url = if path.to_ascii_lowercase().starts_with("file://") {
        url::Url::parse(path)?
    } else {
        let base = url::Url::from_directory_path(base)
            .map_err(|_| anyhow::anyhow!("source_not_authorized"))?;
        base.join(path)?
    };
    ensure!(
        url.scheme() == "file" && url.host_str().is_none_or(|host| host == "localhost"),
        "source_not_authorized"
    );
    url.to_file_path()
        .map_err(|_| anyhow::anyhow!("source_not_authorized"))
}
