use anyhow::Result;
use url::Url;
use uuid::Uuid;

pub const LUOKE_AVATAR_REF: &str = "rovai://member-avatar/builtin/luoke/v1";
pub const MUWA_AVATAR_REF: &str = "rovai://member-avatar/builtin/muwa/v1";
pub const MIANZHI_AVATAR_REF: &str = "rovai://member-avatar/builtin/mianzhi/v1";
pub const QILU_AVATAR_REF: &str = "rovai://member-avatar/builtin/qilu/v1";

pub const BUILTIN_PROFILE_AVATARS: [(&str, &str); 4] = [
    ("agent_1", LUOKE_AVATAR_REF),
    ("agent_2", MUWA_AVATAR_REF),
    ("agent_3", MIANZHI_AVATAR_REF),
    ("agent_4", QILU_AVATAR_REF),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinMemberAvatar {
    Luoke,
    Muwa,
    Mianzhi,
    Qilu,
}

impl BuiltinMemberAvatar {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Luoke => "luoke",
            Self::Muwa => "muwa",
            Self::Mianzhi => "mianzhi",
            Self::Qilu => "qilu",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberAvatarReference {
    Builtin(BuiltinMemberAvatar),
    Managed(Uuid),
}

pub fn parse_member_avatar_ref(value: &str) -> Result<MemberAvatarReference> {
    let url = Url::parse(value).map_err(|_| invalid_avatar_ref())?;
    if url.scheme() != "rovai"
        || url.host_str() != Some("member-avatar")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid_avatar_ref());
    }
    let segments = url
        .path_segments()
        .ok_or_else(invalid_avatar_ref)?
        .collect::<Vec<_>>();
    match segments.as_slice() {
        ["builtin", role, "v1"] => {
            let builtin = match *role {
                "luoke" => BuiltinMemberAvatar::Luoke,
                "muwa" => BuiltinMemberAvatar::Muwa,
                "mianzhi" => BuiltinMemberAvatar::Mianzhi,
                "qilu" => BuiltinMemberAvatar::Qilu,
                _ => return Err(invalid_avatar_ref()),
            };
            let canonical = format!("rovai://member-avatar/builtin/{}/v1", builtin.as_str());
            if value != canonical {
                return Err(invalid_avatar_ref());
            }
            Ok(MemberAvatarReference::Builtin(builtin))
        }
        ["managed", asset_id] => {
            let asset_id = Uuid::parse_str(asset_id).map_err(|_| invalid_avatar_ref())?;
            let canonical = format!("rovai://member-avatar/managed/{}", asset_id.hyphenated());
            if value != canonical {
                return Err(invalid_avatar_ref());
            }
            Ok(MemberAvatarReference::Managed(asset_id))
        }
        _ => Err(invalid_avatar_ref()),
    }
}

pub fn validate_new_member_avatar_ref(value: Option<&str>) -> Result<()> {
    if let Some(value) = value {
        parse_member_avatar_ref(value)?;
    }
    Ok(())
}

pub fn validate_member_avatar_update(current: Option<&str>, next: Option<&str>) -> Result<()> {
    if current == next {
        return Ok(());
    }
    validate_new_member_avatar_ref(next)
}

fn invalid_avatar_ref() -> anyhow::Error {
    anyhow::anyhow!(
        "AgentProfile avatarRef must be null or a supported rovai://member-avatar reference"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_builtin_and_managed_references() {
        assert_eq!(
            parse_member_avatar_ref(LUOKE_AVATAR_REF).unwrap(),
            MemberAvatarReference::Builtin(BuiltinMemberAvatar::Luoke)
        );
        let asset_id = Uuid::new_v4();
        let value = format!("rovai://member-avatar/managed/{asset_id}");
        assert_eq!(
            parse_member_avatar_ref(&value).unwrap(),
            MemberAvatarReference::Managed(asset_id)
        );
    }

    #[test]
    fn rejects_non_canonical_or_unsafe_references() {
        for value in [
            "",
            "builtin://camp-companions/luoke/v1",
            "managed://member-avatars/2b945f3f-4b45-4ae5-92b2-739fce600338",
            "file:///tmp/avatar.png",
            "https://example.com/avatar.png",
            "data:image/png;base64,AAAA",
            "/tmp/avatar.png",
            "rovai://member-avatar/builtin/unknown/v1",
            "rovai://member-avatar/builtin/luoke/v2",
            "rovai://member-avatar/builtin/luoke/v1/",
            "rovai://member-avatar/builtin/luoke/v1?size=32",
            "rovai://member-avatar/builtin/luoke/v1#preview",
            "rovai://member-avatar/managed/------------------------------------",
            "rovai://member-avatar/managed/2B945F3F-4B45-4AE5-92B2-739FCE600338",
            "ROVAI://MEMBER-AVATAR/builtin/luoke/v1",
            "rovai://member-avatar/managed/2b945f3f-4b45-4ae5-92b2-739fce600338/extra",
            "rovai://member-avatar/managed/2b945f3f-4b45-4ae5-92b2-739fce600338%2Fextra",
        ] {
            assert!(parse_member_avatar_ref(value).is_err(), "{value}");
        }
    }

    #[test]
    fn permits_unchanged_legacy_values_but_not_new_legacy_values() {
        let legacy = Some("legacy://avatar");
        assert!(validate_member_avatar_update(legacy, legacy).is_ok());
        assert!(validate_member_avatar_update(None, legacy).is_err());
        assert!(validate_member_avatar_update(legacy, None).is_ok());
        assert!(validate_member_avatar_update(legacy, Some(MUWA_AVATAR_REF)).is_ok());
    }
}
