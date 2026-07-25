const SECRET_ASSIGNMENT_KEYS: &[&str] = &[
    "password",
    "passwd",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "auth_token",
    "client_secret",
    "private_key",
];

const SAFE_PLACEHOLDERS: &[&str] = &[
    "",
    "redacted",
    "<redacted>",
    "[redacted]",
    "***",
    "placeholder",
    "<token>",
    "<password>",
    "${env}",
    "${token}",
    "${password}",
];

pub fn contains_secret(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    if lower.contains("-----begin private key-----")
        || lower.contains("-----begin rsa private key-----")
        || lower.contains("-----begin ec private key-----")
        || lower.contains("-----begin openssh private key-----")
    {
        return true;
    }
    if contains_authorization_credential(&lower) || contains_known_token_prefix(body) {
        return true;
    }
    body.lines().any(line_contains_secret_assignment)
}

fn contains_authorization_credential(lower: &str) -> bool {
    for marker in ["authorization:", "authorization="] {
        let mut remaining = lower;
        while let Some(index) = remaining.find(marker) {
            let value = remaining[index + marker.len()..]
                .split(['\r', '\n', ',', ';'])
                .next()
                .unwrap_or_default()
                .trim()
                .trim_matches(['"', '\'', '`']);
            if let Some(credential) = value
                .strip_prefix("bearer ")
                .or_else(|| value.strip_prefix("basic "))
                && credential.len() >= 12
                && !is_safe_placeholder(credential)
            {
                return true;
            }
            remaining = &remaining[index + marker.len()..];
        }
    }
    false
}

fn contains_known_token_prefix(body: &str) -> bool {
    let prefixes = [
        "github_pat_",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "xoxb-",
        "xoxp-",
        "xoxa-",
        "xoxr-",
        "sk-proj-",
        "sk-ant-",
        "AIza",
        "AKIA",
    ];
    body.split(|character: char| {
        character.is_whitespace()
            || matches!(
                character,
                '"' | '\'' | '`' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
            )
    })
    .any(|candidate| {
        prefixes
            .iter()
            .any(|prefix| candidate.starts_with(prefix) && candidate.len() >= prefix.len() + 12)
    })
}

fn line_contains_secret_assignment(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.starts_with('#') || trimmed.starts_with("//") {
        return false;
    }
    let Some((key, value)) = trimmed.split_once('=').or_else(|| trimmed.split_once(':')) else {
        return false;
    };
    let key = key
        .trim()
        .trim_matches(['"', '\'', '`'])
        .to_ascii_lowercase()
        .replace('-', "_");
    if !SECRET_ASSIGNMENT_KEYS.contains(&key.as_str()) {
        return false;
    }
    let value = value.trim().trim_matches(['"', '\'', '`', ',', ';']).trim();
    value.len() >= 8 && !is_safe_placeholder(value)
}

fn is_safe_placeholder(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    SAFE_PLACEHOLDERS.contains(&normalized.as_str())
        || (normalized.starts_with("${") && normalized.ends_with('}'))
        || (normalized.starts_with('<') && normalized.ends_with('>'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_high_confidence_credentials_without_returning_matches() {
        assert!(contains_secret(
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"
        ));
        assert!(contains_secret("api_key = \"abcdefghijklmnop\""));
        assert!(contains_secret(
            "github_pat_1234567890abcdefghijklmnopqrstuvwxyz"
        ));
        assert!(contains_secret(
            "-----BEGIN PRIVATE KEY-----\nnot-even-a-real-key"
        ));
    }

    #[test]
    fn accepts_redacted_examples_and_ordinary_personal_text() {
        assert!(!contains_secret("api_key = ${ENV}"));
        assert!(!contains_secret("password: <redacted>"));
        assert!(!contains_secret(
            "用户偏好在提交前检查 API key 是否来自环境变量。"
        ));
        assert!(!contains_secret(
            "Agreement: never paste a password into chat."
        ));
    }
}
