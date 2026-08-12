/// The sole durable identity for the current local Rovai user.
///
/// This value is a Core-owned domain identity. Agent input and Renderer code
/// must never choose or infer it from display text.
pub const CURRENT_USER_ID: &str = "local_user";

/// Rovai does not yet expose an editable current-user profile. Keep the
/// presentation fallback separate from the durable identity so future locale
/// or profile projection cannot alter semantic message content.
pub const CURRENT_USER_DISPLAY_NAME_ZH: &str = "你";
pub const CURRENT_USER_DISPLAY_NAME_EN: &str = "You";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedCurrentUser {
    pub user_id: &'static str,
    pub display_name: &'static str,
}

/// Resolves the one Core-owned local user without consulting message authors,
/// Runtime callers, Renderer copy, or Agent input.
#[derive(Debug, Default, Clone, Copy)]
pub struct CurrentUserResolver;

impl CurrentUserResolver {
    pub fn resolve(locale: &str) -> ResolvedCurrentUser {
        let display_name = if locale.eq_ignore_ascii_case("zh")
            || locale.to_ascii_lowercase().starts_with("zh-")
        {
            CURRENT_USER_DISPLAY_NAME_ZH
        } else {
            CURRENT_USER_DISPLAY_NAME_EN
        };
        ResolvedCurrentUser {
            user_id: CURRENT_USER_ID,
            display_name,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolver_keeps_identity_stable_across_localized_fallbacks() {
        let zh = CurrentUserResolver::resolve("zh-CN");
        let en = CurrentUserResolver::resolve("en-US");
        assert_eq!(zh.user_id, CURRENT_USER_ID);
        assert_eq!(en.user_id, CURRENT_USER_ID);
        assert_eq!(zh.display_name, "你");
        assert_eq!(en.display_name, "You");
    }
}
