use std::{fmt, str::FromStr};

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use uuid::{Uuid, Variant};

const PREFIX: &str = "rvcamp_";
const SUFFIX_LENGTH: usize = 26;
const TOTAL_LENGTH: usize = PREFIX.len() + SUFFIX_LENGTH;
const CROCKFORD: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

pub const CAMP_ID_PATTERN: &str = "^rvcamp_[0-7][0123456789abcdefghjkmnpqrstvwxyz]{25}$";

/// The sole durable and public identity of a Rovai Camp.
///
/// `CampId` accepts only canonical lower-case TypeID spelling whose 128-bit
/// payload is an RFC-compatible UUIDv7. A parsed value is therefore safe to
/// use as a managed filesystem component as well as a SQLite key.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CampId(String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CampIdParseError {
    reason: &'static str,
}

impl CampIdParseError {
    const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

impl fmt::Display for CampIdParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid Camp ID: {}", self.reason)
    }
}

impl std::error::Error for CampIdParseError {}

impl CampId {
    pub fn new() -> Self {
        Self::from_uuid_v7(Uuid::now_v7())
    }

    pub fn parse(value: &str) -> Result<Self, CampIdParseError> {
        if value.len() != TOTAL_LENGTH || !value.starts_with(PREFIX) {
            return Err(CampIdParseError::new(
                "expected rvcamp_ followed by 26 canonical base32 characters",
            ));
        }
        let suffix = &value.as_bytes()[PREFIX.len()..];
        let mut decoded = 0_u128;
        for (index, byte) in suffix.iter().copied().enumerate() {
            let digit = crockford_value(byte).ok_or_else(|| {
                CampIdParseError::new("suffix is not canonical lower-case Crockford Base32")
            })?;
            if index == 0 && digit > 7 {
                return Err(CampIdParseError::new("suffix overflows 128 bits"));
            }
            decoded = (decoded << 5) | u128::from(digit);
        }
        let uuid = Uuid::from_u128(decoded);
        if uuid.get_version_num() != 7 {
            return Err(CampIdParseError::new("payload is not UUIDv7"));
        }
        if uuid.get_variant() != Variant::RFC4122 {
            return Err(CampIdParseError::new(
                "payload does not use the RFC 4122 variant",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn from_uuid_v7(uuid: Uuid) -> Self {
        debug_assert_eq!(uuid.get_version_num(), 7);
        debug_assert_eq!(uuid.get_variant(), Variant::RFC4122);
        Self(format!("{PREFIX}{}", encode_uuid(uuid)))
    }
}

pub(crate) fn deserialize_camp_id_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    CampId::deserialize(deserializer).map(|camp_id| camp_id.to_string())
}

impl Default for CampId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for CampId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for CampId {
    type Err = CampIdParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

impl Serialize for CampId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CampId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(de::Error::custom)
    }
}

impl ToSql for CampId {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(ValueRef::Text(self.0.as_bytes())))
    }
}

impl FromSql for CampId {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let value = value.as_str()?;
        Self::parse(value).map_err(|error| FromSqlError::Other(Box::new(error)))
    }
}

fn encode_uuid(uuid: Uuid) -> String {
    let mut value = uuid.as_u128();
    let mut suffix = [b'0'; SUFFIX_LENGTH];
    for byte in suffix.iter_mut().rev() {
        *byte = CROCKFORD[(value & 31) as usize];
        value >>= 5;
    }
    debug_assert_eq!(value, 0);
    std::str::from_utf8(&suffix)
        .expect("Camp ID alphabet is ASCII")
        .to_owned()
}

fn crockford_value(byte: u8) -> Option<u8> {
    CROCKFORD
        .iter()
        .position(|candidate| *candidate == byte)
        .map(|index| index as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn generated_ids_are_canonical_uuid_v7_typeids() {
        let id = CampId::new();
        assert_eq!(id.as_str().len(), TOTAL_LENGTH);
        assert!(id.as_str().starts_with(PREFIX));
        assert_eq!(CampId::parse(id.as_str()), Ok(id.clone()));
        assert_eq!(id.to_string(), id.as_str());
    }

    #[test]
    fn parser_rejects_noncanonical_or_non_v7_payloads() {
        let valid = CampId::new().to_string();
        assert!(CampId::parse(&valid.to_uppercase()).is_err());
        assert!(CampId::parse("rvcamp_81h47kvsy5fk1shh6w1g60eecf").is_err());

        let mut forbidden = valid.into_bytes();
        forbidden[PREFIX.len() + 1] = b'i';
        assert!(CampId::parse(std::str::from_utf8(&forbidden).unwrap()).is_err());

        let encoded_v4 = format!("{PREFIX}{}", encode_uuid(Uuid::new_v4()));
        assert!(CampId::parse(&encoded_v4).is_err());
        assert!(CampId::parse("rvcamp_01h47kvsy5fk1hhh6w1g60eecf").is_err());
    }

    #[test]
    fn serde_and_sqlite_round_trip_through_validation() {
        let id = CampId::new();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(serde_json::from_str::<CampId>(&json).unwrap(), id);
        assert!(serde_json::from_str::<CampId>(r#""camp-legacy""#).is_err());

        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute("CREATE TABLE camp_id_round_trip(id TEXT PRIMARY KEY)", [])
            .unwrap();
        connection
            .execute("INSERT INTO camp_id_round_trip(id) VALUES (?1)", [&id])
            .unwrap();
        let loaded: CampId = connection
            .query_row("SELECT id FROM camp_id_round_trip", [], |row| row.get(0))
            .unwrap();
        assert_eq!(loaded, id);
    }
}
