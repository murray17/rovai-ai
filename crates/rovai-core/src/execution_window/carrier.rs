//! A display-only proof: a Shell carrying exactly one Rovai invocation may count with its
//! verified Core operation. Dynamic syntax, extra commands and incomplete stdin stay separate.
#[derive(Clone)]
struct Token {
    raw: String,
    value: String,
    operator: bool,
}

fn tokens(source: &str) -> Vec<Token> {
    let mut result = Vec::new();
    let mut raw = String::new();
    let mut value = String::new();
    let mut quote = None;
    let mut escaped = false;
    let flush = |result: &mut Vec<Token>, raw: &mut String, value: &mut String| {
        if !raw.is_empty() {
            result.push(Token {
                raw: std::mem::take(raw),
                value: std::mem::take(value),
                operator: false,
            });
        }
    };
    let mut chars = source.chars().peekable();
    while let Some(ch) = chars.next() {
        if escaped {
            raw.push(ch);
            value.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            raw.push(ch);
            escaped = true;
            continue;
        }
        if let Some(marker) = quote {
            raw.push(ch);
            if ch == marker {
                quote = None;
            } else {
                value.push(ch);
            }
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            raw.push(ch);
            quote = Some(ch);
            continue;
        }
        if matches!(ch, ';' | '&' | '|' | '\n' | '\r') {
            flush(&mut result, &mut raw, &mut value);
            let mut op = if ch == '\n' || ch == '\r' {
                ";".into()
            } else {
                ch.to_string()
            };
            if (ch == '&' || ch == '|') && chars.peek() == Some(&ch) {
                chars.next();
                op.push(ch);
            }
            if ch == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            if op != ";" || result.last().is_some_and(|token| !token.operator) {
                result.push(Token {
                    raw: op.clone(),
                    value: op,
                    operator: true,
                });
            }
        } else if ch.is_whitespace() {
            flush(&mut result, &mut raw, &mut value);
        } else {
            raw.push(ch);
            value.push(ch);
        }
    }
    if escaped {
        value.push('\\');
    }
    flush(&mut result, &mut raw, &mut value);
    if result
        .last()
        .is_some_and(|token| token.operator && token.value == ";")
    {
        result.pop();
    }
    result
}

fn executable(value: &str) -> String {
    value
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase()
}
fn assignment(value: &str) -> bool {
    value.split_once('=').is_some_and(|(key, _)| {
        !key.is_empty()
            && key.chars().enumerate().all(|(i, ch)| {
                ch == '_' || ch.is_ascii_alphabetic() || (i > 0 && ch.is_ascii_digit())
            })
    })
}
fn operation(tokens: &[Token]) -> Option<String> {
    let mut cursor = usize::from(
        tokens
            .first()
            .is_some_and(|token| executable(&token.value) == "env"),
    );
    while tokens
        .get(cursor)
        .is_some_and(|token| assignment(&token.value))
    {
        cursor += 1;
    }
    if tokens
        .get(cursor)
        .is_some_and(|token| matches!(executable(&token.value).as_str(), "npx" | "bunx"))
    {
        cursor += 1;
        if tokens
            .get(cursor)
            .is_some_and(|token| matches!(token.value.as_str(), "--yes" | "-y"))
        {
            cursor += 1;
        }
    }
    if tokens
        .get(cursor)
        .is_none_or(|token| executable(&token.value) != "rovai")
    {
        return None;
    }
    let words = tokens.get(cursor + 1..)?;
    let first = words.first()?.value.as_str();
    let second = words.get(1).map(|token| token.value.as_str()).unwrap_or("");
    if first == "send" {
        return Some("thread.message.send".into());
    }
    // The CLI catalog owns operation identities; a historical alias is not guessed here.
    if first == "camp" {
        return None;
    }
    crate::builtin_tool_transport::builtin_tool_identity_by_command(first, second)
        .map(|identity| crate::thread_compat::canonical_operation(identity.operation).to_string())
}

fn dynamic(value: &str, heredoc: bool) -> bool {
    let mut quote = None;
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if !heredoc && quote == Some('\'') {
            if ch == '\'' {
                quote = None;
            }
            continue;
        }
        if ch == '\\' {
            chars.next();
            continue;
        }
        if ch == '`' || (ch == '$' && chars.peek() == Some(&'(')) {
            return true;
        }
        if !heredoc {
            if ch == '"' {
                quote = if quote == Some('"') { None } else { Some('"') };
            } else if quote.is_none() && matches!(ch, '<' | '>') {
                return true;
            } else if quote.is_none() && ch == '\'' {
                quote = Some(ch);
            }
        }
    }
    !heredoc && quote.is_some()
}

// Same CSI/OSC presentation normalization as the shared renderer; never an execution parser.
fn strip_ansi(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut out = String::new();
    let mut start = 0;
    let mut cursor = 0;
    while cursor + 1 < bytes.len() {
        if bytes[cursor] != 0x1b {
            cursor += 1;
            continue;
        }
        let mut end = cursor + 2;
        if bytes[cursor + 1] == b'[' {
            while end < bytes.len() && (0x30..=0x3f).contains(&bytes[end]) {
                end += 1;
            }
            while end < bytes.len() && (0x20..=0x2f).contains(&bytes[end]) {
                end += 1;
            }
            if end < bytes.len() && (0x40..=0x7e).contains(&bytes[end]) {
                end += 1;
            } else {
                cursor += 1;
                continue;
            }
        } else if bytes[cursor + 1] == b']' {
            while end < bytes.len()
                && bytes[end] != 7
                && !(bytes[end] == 0x1b && bytes.get(end + 1) == Some(&b'\\'))
            {
                end += 1;
            }
            if end == bytes.len() {
                cursor += 1;
                continue;
            }
            end += if bytes[end] == 7 { 1 } else { 2 };
        } else {
            cursor += 1;
            continue;
        }
        out.push_str(&source[start..cursor]);
        start = end;
        cursor = end;
    }
    out.push_str(&source[start..]);
    out
}

pub(super) fn pure_builtin_operation(source: &str) -> Option<String> {
    let mut source = strip_ansi(source).trim().to_string();
    for _ in 0..3 {
        let parts = tokens(&source);
        if parts.len() < 3 || parts.iter().any(|token| token.operator) {
            break;
        }
        let name = executable(&parts[0].value).to_ascii_lowercase();
        let raw_name = executable(parts[0].raw.trim_matches(['\'', '"']));
        let powershell = matches!(
            raw_name.as_str(),
            "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe"
        ) || matches!(
            name.as_str(),
            "pwsh" | "pwsh.exe" | "powershell" | "powershell.exe"
        );
        if !powershell
            && !matches!(
                name.as_str(),
                "bash" | "dash" | "fish" | "ksh" | "sh" | "zsh"
            )
        {
            break;
        }
        let command = parts.iter().position(|token| {
            if powershell {
                matches!(token.value.to_ascii_lowercase().as_str(), "-c" | "-command")
            } else {
                matches!(token.value.as_str(), "-c" | "-lc")
            }
        });
        let Some(command) = command.filter(|index| index + 2 == parts.len()) else {
            break;
        };
        source = parts[command + 1].value.trim().into();
    }
    let lines = source.lines().collect::<Vec<_>>();
    let mut retained = Vec::new();
    let mut line = 0;
    while line < lines.len() {
        let parts = tokens(lines[line]);
        let mut keep = Vec::new();
        let mut cursor = 0;
        while cursor < parts.len() {
            let token = &parts[cursor];
            let redirect = ["0<<<", "<<<", "0<<-", "<<-", "0<<", "<<"]
                .into_iter()
                .find(|prefix| token.raw.starts_with(prefix));
            let Some(redirect) = redirect else {
                keep.push(token.clone());
                cursor += 1;
                continue;
            };
            operation(&keep)?;
            let attached = &token.value[redirect.len()..];
            let (marker, raw) = if attached.is_empty() {
                cursor += 1;
                let next = parts.get(cursor)?;
                if next.operator {
                    return None;
                }
                (next.value.as_str(), next.raw.as_str())
            } else {
                (attached, &token.raw[redirect.len()..])
            };
            if redirect.ends_with("<<<") {
                if dynamic(raw, false) {
                    return None;
                }
            } else {
                if marker.is_empty()
                    || !marker.chars().enumerate().all(|(i, ch)| {
                        ch == '_' || ch.is_ascii_alphabetic() || (i > 0 && ch.is_ascii_digit())
                    })
                {
                    return None;
                }
                let start = line + 1;
                line += 1;
                while line < lines.len()
                    && (if redirect.ends_with('-') {
                        lines[line].trim_start_matches('\t')
                    } else {
                        lines[line]
                    }) != marker
                {
                    line += 1;
                }
                if line == lines.len() {
                    return None;
                }
                if !raw.contains(['\'', '"', '\\']) && dynamic(&lines[start..line].join("\n"), true)
                {
                    return None;
                }
            }
            cursor += 1;
        }
        retained.push(
            keep.iter()
                .map(|token| token.raw.as_str())
                .collect::<Vec<_>>()
                .join(" "),
        );
        line += 1;
    }
    let parts = tokens(&retained.join("\n"));
    if parts.iter().any(|token| {
        token.operator
            || dynamic(&token.raw, false)
            || matches!(token.value.as_str(), "--help" | "-h" | "--version" | "-V")
    }) {
        return None;
    }
    operation(&parts)
}

#[cfg(test)]
mod tests {
    use super::pure_builtin_operation;
    #[test]
    fn carrier_count_requires_one_static_cli_invocation() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/execution-carrier-cases.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let command = case["command"].as_str().unwrap();
            assert_eq!(
                pure_builtin_operation(command).as_deref(),
                case["operation"].as_str(),
                "{command}"
            );
        }
    }
}
