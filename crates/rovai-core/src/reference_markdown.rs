/// Escape link text without changing ordinary filename or title punctuation.
pub(crate) fn escape_link_label(label: &str) -> String {
    let mut escaped = String::with_capacity(label.len());
    for c in label.chars() {
        if matches!(
            c,
            '\\' | '[' | ']' | '`' | '*' | '_' | '~' | '<' | '&' | '|'
        ) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}
