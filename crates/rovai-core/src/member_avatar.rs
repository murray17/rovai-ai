use std::{
    fs::{self, OpenOptions},
    io::{BufReader, Cursor, Read, Write},
    path::Path,
};

#[cfg(not(windows))]
use std::fs::File;

use anyhow::Result;
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

const SELECTED_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MINIMUM_DECODED_EDGE: u32 = 256;
const MAXIMUM_DECODED_EDGE: u32 = 8192;
const MAXIMUM_DECODED_PIXELS: u64 = 32_000_000;
const NORMALIZED_MAXIMUM_EDGE: u32 = 2048;
const NORMALIZED_SOURCE_BYTES: usize = 16 * 1024 * 1024;
const ICON_EDGE: u32 = 192;
const ICON_BYTES: usize = 1024 * 1024;
const MANIFEST_BYTES: usize = 16 * 1024;
const MAXIMUM_DECODE_ALLOCATION: u64 = 256 * 1024 * 1024;

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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedMemberAvatarSummary {
    pub avatar_ref: String,
    pub source_width: u32,
    pub source_height: u32,
    pub crop: MemberAvatarCrop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberAvatarCrop {
    pub center_x: f64,
    pub center_y: f64,
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberAvatarImportErrorKind {
    Invalid,
    CreationKeyConflict,
}

#[derive(Debug)]
pub struct MemberAvatarImportError {
    pub kind: MemberAvatarImportErrorKind,
    message: &'static str,
}

impl MemberAvatarImportError {
    fn invalid(message: &'static str) -> Self {
        Self {
            kind: MemberAvatarImportErrorKind::Invalid,
            message,
        }
    }

    fn conflict() -> Self {
        Self {
            kind: MemberAvatarImportErrorKind::CreationKeyConflict,
            message: "creationKey is already bound to a different avatar",
        }
    }
}

impl std::fmt::Display for MemberAvatarImportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for MemberAvatarImportError {}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvatarManifestFile {
    file: String,
    media_type: String,
    width: u32,
    height: u32,
    byte_length: usize,
    sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvatarManifestSource {
    #[serde(flatten)]
    file: AvatarManifestFile,
    orientation_normalized: bool,
    metadata_stripped: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvatarManifestV1 {
    schema_version: u32,
    asset_id: String,
    created_at: String,
    source: AvatarManifestSource,
    icon: AvatarManifestFile,
    icon_crop: MemberAvatarCrop,
}

/// Imports a run-readable PNG or JPEG into the same compound managed-avatar
/// format used by Electron Main. The caller supplies a deterministic asset ID
/// so a retried member creation can verify rather than duplicate the bytes.
pub fn import_managed_member_avatar(
    data_dir: &Path,
    asset_id: Uuid,
    selected_file: &Path,
) -> std::result::Result<ManagedMemberAvatarSummary, MemberAvatarImportError> {
    let normalized = normalize_selected_avatar(selected_file)?;
    let (source_width, source_height) = normalized.dimensions();
    let (crop_x, crop_y, crop_edge) = default_avatar_crop(source_width, source_height);
    let icon = normalized
        .crop_imm(crop_x, crop_y, crop_edge, crop_edge)
        .resize_exact(ICON_EDGE, ICON_EDGE, image::imageops::FilterType::Lanczos3);
    let source_png = encode_png(&normalized)?;
    let icon_png = encode_png(&icon)?;
    if source_png.len() > NORMALIZED_SOURCE_BYTES || icon_png.len() > ICON_BYTES {
        return Err(MemberAvatarImportError::invalid(
            "Normalized avatar exceeds the managed asset limit",
        ));
    }
    let crop = default_member_avatar_crop(source_width, source_height);
    publish_managed_member_avatar(
        data_dir,
        asset_id,
        &source_png,
        &icon_png,
        source_width,
        source_height,
        crop,
    )
}

fn normalize_selected_avatar(
    selected_file: &Path,
) -> Result<DynamicImage, MemberAvatarImportError> {
    let selected_bytes = read_selected_avatar(selected_file)?;
    let format = image::guess_format(&selected_bytes)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar must be a PNG or JPEG image"))?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg) {
        return Err(MemberAvatarImportError::invalid(
            "Avatar must be a PNG or JPEG image",
        ));
    }
    if format == ImageFormat::Png {
        reject_animated_png(&selected_bytes)?;
    }

    let mut reader = ImageReader::with_format(Cursor::new(&selected_bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAXIMUM_DECODED_EDGE);
    limits.max_image_height = Some(MAXIMUM_DECODED_EDGE);
    limits.max_alloc = Some(MAXIMUM_DECODE_ALLOCATION);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| MemberAvatarImportError::invalid("Avatar image could not be decoded"))?;
    let (decoded_width, decoded_height) = decoder.dimensions();
    validate_decoded_dimensions(decoded_width, decoded_height)?;
    if decoder.total_bytes() > MAXIMUM_DECODE_ALLOCATION {
        return Err(MemberAvatarImportError::invalid(
            "Avatar image exceeds the decoded resource limit",
        ));
    }
    let orientation = decoder
        .orientation()
        .map_err(|_| MemberAvatarImportError::invalid("Avatar orientation is invalid"))?;
    let mut decoded = DynamicImage::from_decoder(decoder)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar image could not be decoded"))?;
    decoded.apply_orientation(orientation);
    validate_decoded_dimensions(decoded.width(), decoded.height())?;

    let normalized = if decoded.width() > NORMALIZED_MAXIMUM_EDGE
        || decoded.height() > NORMALIZED_MAXIMUM_EDGE
    {
        decoded.resize(
            NORMALIZED_MAXIMUM_EDGE,
            NORMALIZED_MAXIMUM_EDGE,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        decoded
    };
    let normalized = DynamicImage::ImageRgba8(normalized.to_rgba8());
    Ok(normalized)
}

/// Reuses creation's decoder and normalization, with an optional explicit crop.
pub fn prepare_member_avatar(
    data_dir: &Path,
    asset_id: Uuid,
    selected_file: &Path,
    crop: Option<MemberAvatarCrop>,
    verify_existing_only: bool,
) -> Result<ManagedMemberAvatarSummary> {
    let source = normalize_selected_avatar(selected_file)?;
    let source_png = encode_png(&source)?;
    save_cropped_source(
        data_dir,
        &source_png,
        source,
        crop,
        Some((asset_id, verify_existing_only)),
    )
}

pub fn recrop_member_avatar(
    data_dir: &Path,
    avatar_ref: &str,
    crop: MemberAvatarCrop,
) -> Result<ManagedMemberAvatarSummary> {
    let source_png = member_avatar_bytes(data_dir, avatar_ref, true)?;
    let source = image::load_from_memory_with_format(&source_png, ImageFormat::Png)?;
    save_cropped_source(data_dir, &source_png, source, Some(crop), None)
}

fn default_member_avatar_crop(width: u32, height: u32) -> MemberAvatarCrop {
    let (x, y, edge) = default_avatar_crop(width, height);
    MemberAvatarCrop {
        center_x: (f64::from(x) + f64::from(edge) / 2.0) / f64::from(width),
        center_y: (f64::from(y) + f64::from(edge) / 2.0) / f64::from(height),
        size: f64::from(edge) / f64::from(width.min(height)),
    }
}

fn save_cropped_source(
    data_dir: &Path,
    source_png: &[u8],
    source: DynamicImage,
    crop: Option<MemberAvatarCrop>,
    asset_id: Option<(Uuid, bool)>,
) -> Result<ManagedMemberAvatarSummary> {
    let (width, height) = source.dimensions();
    let crop = crop.unwrap_or_else(|| default_member_avatar_crop(width, height));
    validate_crop(&crop, width, height)?;
    let edge = (crop.size * f64::from(width.min(height))).round().max(1.0) as u32;
    let x = (crop.center_x * f64::from(width) - f64::from(edge) / 2.0)
        .round()
        .max(0.0) as u32;
    let y = (crop.center_y * f64::from(height) - f64::from(edge) / 2.0)
        .round()
        .max(0.0) as u32;
    let icon = source
        .crop_imm(x.min(width - edge), y.min(height - edge), edge, edge)
        .resize_exact(ICON_EDGE, ICON_EDGE, image::imageops::FilterType::Lanczos3);
    let icon_png = encode_png(&icon)?;
    anyhow::ensure!(
        source_png.len() <= NORMALIZED_SOURCE_BYTES && icon_png.len() <= ICON_BYTES,
        "Normalized avatar exceeds the managed asset limit"
    );
    if let Some((asset_id, verify_existing_only)) = asset_id {
        if verify_existing_only {
            let directory = data_dir.join("member-avatars").join(asset_id.to_string());
            if !existing_asset_matches(
                &directory,
                &asset_id.to_string(),
                &manifest_file("source.png", width, height, source_png),
                &manifest_file("icon-192.png", ICON_EDGE, ICON_EDGE, &icon_png),
                &crop,
            )
            .unwrap_or(false)
            {
                return Err(MemberAvatarImportError::conflict().into());
            }
            return Ok(ManagedMemberAvatarSummary {
                avatar_ref: format!("rovai://member-avatar/managed/{asset_id}"),
                source_width: width,
                source_height: height,
                crop,
            });
        }
        Ok(publish_managed_member_avatar(
            data_dir, asset_id, source_png, &icon_png, width, height, crop,
        )?)
    } else {
        save_managed_member_avatar(data_dir, source_png, &icon_png, width, height, crop)
    }
}

/// Content equivalence preserves a Profile reference for a visual no-op even
/// when the upload has its own immutable request-bound preparation asset.
pub(crate) fn member_avatar_content_matches(
    data_dir: &Path,
    left: &str,
    right: &str,
) -> Result<bool> {
    if left == right {
        return Ok(true);
    }
    let (Some(left_source), Some(right_source)) = (
        read_managed_member_avatar(data_dir, left, true)?,
        read_managed_member_avatar(data_dir, right, true)?,
    ) else {
        return Ok(false);
    };
    if left_source.base64 != right_source.base64 || left_source.crop != right_source.crop {
        return Ok(false);
    }
    let (Some(left_icon), Some(right_icon)) = (
        read_managed_member_avatar(data_dir, left, false)?,
        read_managed_member_avatar(data_dir, right, false)?,
    ) else {
        return Ok(false);
    };
    Ok(left_icon.base64 == right_icon.base64)
}

/// Core-packaged renditions of the same built-in artwork as the renderer.
/// PNG sources avoid adding a runtime AVIF decoder to the controlled importer.
fn builtin_avatar_bytes(role: BuiltinMemberAvatar, portrait: bool) -> &'static [u8] {
    macro_rules! artwork {
        ($role:literal) => {
            if portrait {
                include_bytes!(concat!("../resources/member-avatars/", $role, ".png"))
            } else {
                include_bytes!(concat!(
                    "../../../apps/desktop/src/renderer/src/assets/characters/",
                    $role,
                    "/icon-192.png"
                ))
            }
        };
    }
    match role {
        BuiltinMemberAvatar::Luoke => artwork!("luoke"),
        BuiltinMemberAvatar::Muwa => artwork!("muwa"),
        BuiltinMemberAvatar::Mianzhi => artwork!("mianzhi"),
        BuiltinMemberAvatar::Qilu => artwork!("qilu"),
    }
}

fn member_avatar_bytes(data_dir: &Path, avatar_ref: &str, portrait: bool) -> Result<Vec<u8>> {
    use base64::Engine;
    match parse_member_avatar_ref(avatar_ref)? {
        MemberAvatarReference::Builtin(role) => Ok(builtin_avatar_bytes(role, portrait).to_vec()),
        MemberAvatarReference::Managed(_) => {
            let rendition = read_managed_member_avatar(data_dir, avatar_ref, portrait)?
                .ok_or_else(|| anyhow::anyhow!("Avatar rendition is unavailable"))?;
            Ok(base64::engine::general_purpose::STANDARD.decode(rendition.base64)?)
        }
    }
}

/// The caller supplies the authenticated lease's existing Run tmp directory.
/// Files are new/private and share that lease's existing cleanup lifecycle.
pub fn materialize_member_avatar(
    data_dir: &Path,
    run_tmp: &Path,
    avatar_ref: &str,
    portrait: bool,
) -> Result<String> {
    anyhow::ensure!(run_tmp.is_absolute(), "Run tmp must be absolute");
    let metadata = fs::symlink_metadata(run_tmp)?;
    anyhow::ensure!(
        metadata.is_dir() && !metadata.file_type().is_symlink(),
        "Run tmp is unavailable"
    );
    let bytes = member_avatar_bytes(data_dir, avatar_ref, portrait)?;
    let path = run_tmp.join(format!(
        "member-{}-{}.png",
        Uuid::new_v4(),
        if portrait { "portrait" } else { "icon" }
    ));
    if let Err(error) = write_private_file(&path, &bytes) {
        let _ = fs::remove_file(&path);
        return Err(error.into());
    }
    Ok(path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Run tmp path is not UTF-8"))?
        .to_string())
}

/// Saves a normalized, cropped UI asset through the same compound storage used
/// by member creation. Its content identity makes a lost save reply retryable.
pub fn save_managed_member_avatar(
    data_dir: &Path,
    source_png: &[u8],
    icon_png: &[u8],
    source_width: u32,
    source_height: u32,
    crop: MemberAvatarCrop,
) -> Result<ManagedMemberAvatarSummary> {
    anyhow::ensure!(
        source_png.len() <= NORMALIZED_SOURCE_BYTES && icon_png.len() <= ICON_BYTES,
        "Avatar exceeds the managed asset limit"
    );
    validate_normalized_png(
        source_png,
        source_width,
        source_height,
        NORMALIZED_MAXIMUM_EDGE,
    )?;
    validate_normalized_png(icon_png, ICON_EDGE, ICON_EDGE, ICON_EDGE)?;
    validate_crop(&crop, source_width, source_height)?;
    let mut digest = Sha256::new();
    digest.update(source_png);
    digest.update(icon_png);
    digest.update(serde_json::to_vec(&crop)?);
    let hash = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    let asset_id = Uuid::from_bytes(bytes);
    Ok(publish_managed_member_avatar(
        data_dir,
        asset_id,
        source_png,
        icon_png,
        source_width,
        source_height,
        crop,
    )?)
}

fn validate_normalized_png(bytes: &[u8], width: u32, height: u32, maximum: u32) -> Result<()> {
    anyhow::ensure!(
        width > 0 && height > 0 && width <= maximum && height <= maximum,
        "Avatar dimensions are invalid"
    );
    reject_animated_png(bytes)?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    let mut limits = Limits::default();
    limits.max_image_width = Some(maximum);
    limits.max_image_height = Some(maximum);
    limits.max_alloc = Some(MAXIMUM_DECODE_ALLOCATION);
    reader.limits(limits);
    let image = reader.decode()?;
    anyhow::ensure!(
        image.dimensions() == (width, height),
        "Avatar dimensions do not match"
    );
    Ok(())
}

fn validate_crop(crop: &MemberAvatarCrop, width: u32, height: u32) -> Result<()> {
    let half = crop.size * f64::from(width.min(height)) / 2.0;
    anyhow::ensure!(
        crop.center_x.is_finite()
            && crop.center_y.is_finite()
            && crop.size.is_finite()
            && (0.12..=1.0).contains(&crop.size)
            && (half / f64::from(width)..=1.0 - half / f64::from(width)).contains(&crop.center_x)
            && (half / f64::from(height)..=1.0 - half / f64::from(height)).contains(&crop.center_y),
        "Avatar crop is out of bounds"
    );
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedMemberAvatarRendition {
    pub base64: String,
    pub media_type: &'static str,
    pub width: u32,
    pub height: u32,
    pub crop: MemberAvatarCrop,
}

/// Reads only validated managed references and fixed manifest file names.
pub fn read_managed_member_avatar(
    data_dir: &Path,
    avatar_ref: &str,
    portrait: bool,
) -> Result<Option<ManagedMemberAvatarRendition>> {
    use base64::Engine;
    let MemberAvatarReference::Managed(asset_id) = parse_member_avatar_ref(avatar_ref)? else {
        return Ok(None);
    };
    let root = data_dir.join("member-avatars");
    let directory = root.join(asset_id.hyphenated().to_string());
    if !path_exists(&directory)? {
        return Ok(None);
    }
    for path in [&root, &directory] {
        let metadata = fs::symlink_metadata(path)?;
        anyhow::ensure!(
            metadata.is_dir() && !metadata.file_type().is_symlink(),
            "Avatar directory is invalid"
        );
    }
    let manifest: AvatarManifestV1 = serde_json::from_slice(&read_existing_regular_file(
        &directory.join("manifest.json"),
        MANIFEST_BYTES,
    )?)?;
    anyhow::ensure!(
        manifest.schema_version == 1 && manifest.asset_id == asset_id.hyphenated().to_string(),
        "Avatar manifest is invalid"
    );
    validate_crop(
        &manifest.icon_crop,
        manifest.source.file.width,
        manifest.source.file.height,
    )?;
    let (file, name, maximum) = if portrait {
        (&manifest.source.file, "source.png", NORMALIZED_SOURCE_BYTES)
    } else {
        (&manifest.icon, "icon-192.png", ICON_BYTES)
    };
    anyhow::ensure!(
        file.file == name && file.media_type == "image/png",
        "Avatar rendition is invalid"
    );
    let bytes = read_existing_regular_file(&directory.join(name), maximum)?;
    anyhow::ensure!(
        file.byte_length == bytes.len() && sha256(&bytes) == file.sha256,
        "Avatar content changed"
    );
    validate_normalized_png(
        &bytes,
        file.width,
        file.height,
        if portrait {
            NORMALIZED_MAXIMUM_EDGE
        } else {
            ICON_EDGE
        },
    )?;
    Ok(Some(ManagedMemberAvatarRendition {
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        media_type: "image/png",
        width: file.width,
        height: file.height,
        crop: manifest.icon_crop,
    }))
}

fn publish_managed_member_avatar(
    data_dir: &Path,
    asset_id: Uuid,
    source_png: &[u8],
    icon_png: &[u8],
    source_width: u32,
    source_height: u32,
    crop: MemberAvatarCrop,
) -> std::result::Result<ManagedMemberAvatarSummary, MemberAvatarImportError> {
    let asset_id = asset_id.hyphenated().to_string();
    let source_manifest = manifest_file("source.png", source_width, source_height, source_png);
    let icon_manifest = manifest_file("icon-192.png", ICON_EDGE, ICON_EDGE, icon_png);
    let root = data_dir.join("member-avatars");
    ensure_private_directory(&root)?;
    let final_directory = root.join(&asset_id);

    if path_exists(&final_directory)? {
        if matches!(
            existing_asset_matches(
                &final_directory,
                &asset_id,
                &source_manifest,
                &icon_manifest,
                &crop,
            ),
            Ok(true)
        ) {
            return Ok(ManagedMemberAvatarSummary {
                avatar_ref: format!("rovai://member-avatar/managed/{asset_id}"),
                source_width,
                source_height,
                crop,
            });
        }
        return Err(MemberAvatarImportError::conflict());
    }

    let temporary_directory = root.join(format!(".tmp-{asset_id}"));
    remove_scoped_temporary_path(&temporary_directory)?;
    create_private_directory(&temporary_directory)?;
    let write_result = (|| {
        write_private_file(&temporary_directory.join("source.png"), source_png)?;
        write_private_file(&temporary_directory.join("icon-192.png"), icon_png)?;
        let manifest = AvatarManifestV1 {
            schema_version: 1,
            asset_id: asset_id.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            source: AvatarManifestSource {
                file: source_manifest,
                orientation_normalized: true,
                metadata_stripped: true,
            },
            icon: icon_manifest,
            icon_crop: crop.clone(),
        };
        let mut manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|_| MemberAvatarImportError::invalid("Avatar manifest could not be formed"))?;
        manifest_bytes.push(b'\n');
        if manifest_bytes.len() > MANIFEST_BYTES {
            return Err(MemberAvatarImportError::invalid(
                "Avatar manifest exceeds the managed asset limit",
            ));
        }
        write_private_file(&temporary_directory.join("manifest.json"), &manifest_bytes)?;
        sync_directory(&temporary_directory)?;
        fs::rename(&temporary_directory, &final_directory)
            .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be published"))?;
        sync_directory(&root)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = remove_scoped_temporary_path(&temporary_directory);
    }
    write_result?;

    Ok(ManagedMemberAvatarSummary {
        avatar_ref: format!("rovai://member-avatar/managed/{asset_id}"),
        source_width,
        source_height,
        crop,
    })
}

fn validate_decoded_dimensions(
    width: u32,
    height: u32,
) -> std::result::Result<(), MemberAvatarImportError> {
    if width < MINIMUM_DECODED_EDGE || height < MINIMUM_DECODED_EDGE {
        return Err(MemberAvatarImportError::invalid(
            "Avatar image must be at least 256 by 256 pixels",
        ));
    }
    if width > MAXIMUM_DECODED_EDGE
        || height > MAXIMUM_DECODED_EDGE
        || u64::from(width).saturating_mul(u64::from(height)) > MAXIMUM_DECODED_PIXELS
    {
        return Err(MemberAvatarImportError::invalid(
            "Avatar image exceeds the decoded resource limit",
        ));
    }
    Ok(())
}

fn reject_animated_png(bytes: &[u8]) -> std::result::Result<(), MemberAvatarImportError> {
    const PNG_SIGNATURE_BYTES: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if !bytes.starts_with(PNG_SIGNATURE_BYTES) {
        return Err(MemberAvatarImportError::invalid(
            "Avatar must be a PNG or JPEG image",
        ));
    }
    let mut offset = PNG_SIGNATURE_BYTES.len();
    while offset < bytes.len() {
        let header_end = offset
            .checked_add(8)
            .ok_or_else(|| MemberAvatarImportError::invalid("Avatar PNG structure is invalid"))?;
        if header_end > bytes.len() {
            return Err(MemberAvatarImportError::invalid(
                "Avatar PNG structure is invalid",
            ));
        }
        let length = u32::from_be_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| MemberAvatarImportError::invalid("Avatar PNG structure is invalid"))?,
        ) as usize;
        let chunk_type = &bytes[offset + 4..header_end];
        let chunk_end = header_end
            .checked_add(length)
            .and_then(|value| value.checked_add(4))
            .ok_or_else(|| MemberAvatarImportError::invalid("Avatar PNG structure is invalid"))?;
        if chunk_end > bytes.len() {
            return Err(MemberAvatarImportError::invalid(
                "Avatar PNG structure is invalid",
            ));
        }
        if chunk_type == b"acTL" {
            return Err(MemberAvatarImportError::invalid(
                "Animated PNG avatars are not supported",
            ));
        }
        offset = chunk_end;
        if chunk_type == b"IEND" {
            return (offset == bytes.len()).then_some(()).ok_or_else(|| {
                MemberAvatarImportError::invalid("Avatar PNG structure is invalid")
            });
        }
    }
    Err(MemberAvatarImportError::invalid(
        "Avatar PNG structure is invalid",
    ))
}

fn default_avatar_crop(width: u32, height: u32) -> (u32, u32, u32) {
    let edge = width.min(height);
    let x = (width - edge) / 2;
    let available_y = height - edge;
    let preferred_y = ((f64::from(height) * 0.05).round() as u32).min(available_y);
    (x, preferred_y, edge)
}

fn encode_png(image: &DynamicImage) -> std::result::Result<Vec<u8>, MemberAvatarImportError> {
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar image could not be normalized"))?;
    Ok(output.into_inner())
}

fn manifest_file(file: &str, width: u32, height: u32, bytes: &[u8]) -> AvatarManifestFile {
    AvatarManifestFile {
        file: file.to_string(),
        media_type: "image/png".to_string(),
        width,
        height,
        byte_length: bytes.len(),
        sha256: sha256(bytes),
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_selected_avatar(path: &Path) -> std::result::Result<Vec<u8>, MemberAvatarImportError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar file is not readable"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > SELECTED_FILE_BYTES
    {
        return Err(MemberAvatarImportError::invalid(
            "Avatar path must be a regular file no larger than 10 MiB",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let file = options
        .open(path)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar file is not readable"))?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| MemberAvatarImportError::invalid("Avatar file is not readable"))?;
    if !opened_metadata.is_file() || opened_metadata.len() > SELECTED_FILE_BYTES {
        return Err(MemberAvatarImportError::invalid(
            "Avatar path must be a regular file no larger than 10 MiB",
        ));
    }
    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    file.take(SELECTED_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar file is not readable"))?;
    if bytes.len() as u64 > SELECTED_FILE_BYTES {
        return Err(MemberAvatarImportError::invalid(
            "Avatar path must be a regular file no larger than 10 MiB",
        ));
    }
    Ok(bytes)
}

fn ensure_private_directory(directory: &Path) -> std::result::Result<(), MemberAvatarImportError> {
    fs::create_dir_all(directory)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset directory is unavailable"))?;
    let metadata = fs::symlink_metadata(directory)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset directory is unavailable"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(MemberAvatarImportError::invalid(
            "Avatar asset directory is unavailable",
        ));
    }
    #[cfg(unix)]
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset directory is unavailable"))?;
    Ok(())
}

fn create_private_directory(directory: &Path) -> std::result::Result<(), MemberAvatarImportError> {
    #[cfg(unix)]
    let result = fs::DirBuilder::new()
        .recursive(false)
        .mode(0o700)
        .create(directory);
    #[cfg(not(unix))]
    let result = fs::create_dir(directory);
    result.map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be staged"))
}

fn write_private_file(
    path: &Path,
    bytes: &[u8],
) -> std::result::Result<(), MemberAvatarImportError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be written"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be written"))
}

fn sync_directory(directory: &Path) -> std::result::Result<(), MemberAvatarImportError> {
    #[cfg(windows)]
    let _ = directory;
    #[cfg(not(windows))]
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be committed"))?;
    Ok(())
}

fn path_exists(path: &Path) -> std::result::Result<bool, MemberAvatarImportError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(MemberAvatarImportError::invalid(
            "Avatar asset directory is unavailable",
        )),
    }
}

fn remove_scoped_temporary_path(path: &Path) -> std::result::Result<(), MemberAvatarImportError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(MemberAvatarImportError::invalid(
                "Avatar temporary asset could not be inspected",
            ));
        }
    };
    let result = if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path)
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        return Err(MemberAvatarImportError::invalid(
            "Avatar temporary asset has an unsupported type",
        ));
    };
    result
        .map_err(|_| MemberAvatarImportError::invalid("Avatar temporary asset could not be reset"))
}

fn existing_asset_matches(
    directory: &Path,
    asset_id: &str,
    expected_source: &AvatarManifestFile,
    expected_icon: &AvatarManifestFile,
    expected_crop: &MemberAvatarCrop,
) -> std::result::Result<bool, MemberAvatarImportError> {
    let metadata = fs::symlink_metadata(directory)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be inspected"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(false);
    }
    let manifest_path = directory.join("manifest.json");
    let manifest_bytes = read_existing_regular_file(&manifest_path, MANIFEST_BYTES)?;
    let Ok(manifest) = serde_json::from_slice::<AvatarManifestV1>(&manifest_bytes) else {
        return Ok(false);
    };
    if manifest.schema_version != 1
        || manifest.asset_id != asset_id
        || manifest.source.file.sha256 != expected_source.sha256
        || manifest.source.file.width != expected_source.width
        || manifest.source.file.height != expected_source.height
        || manifest.icon.sha256 != expected_icon.sha256
        || &manifest.icon_crop != expected_crop
    {
        return Ok(false);
    }
    let source =
        read_existing_regular_file(&directory.join("source.png"), NORMALIZED_SOURCE_BYTES)?;
    let icon = read_existing_regular_file(&directory.join("icon-192.png"), ICON_BYTES)?;
    Ok(sha256(&source) == expected_source.sha256 && sha256(&icon) == expected_icon.sha256)
}

fn read_existing_regular_file(
    path: &Path,
    maximum_bytes: usize,
) -> std::result::Result<Vec<u8>, MemberAvatarImportError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be inspected"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > maximum_bytes as u64
    {
        return Err(MemberAvatarImportError::invalid(
            "Avatar asset could not be inspected",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let file = options
        .open(path)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be inspected"))?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be inspected"))?;
    if !opened_metadata.is_file() || opened_metadata.len() > maximum_bytes as u64 {
        return Err(MemberAvatarImportError::invalid(
            "Avatar asset could not be inspected",
        ));
    }
    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    BufReader::new(file)
        .take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| MemberAvatarImportError::invalid("Avatar asset could not be inspected"))?;
    if bytes.len() > maximum_bytes {
        return Err(MemberAvatarImportError::invalid(
            "Avatar asset could not be inspected",
        ));
    }
    Ok(bytes)
}

fn invalid_avatar_ref() -> anyhow::Error {
    anyhow::anyhow!(
        "AgentProfile avatarRef must be null or a supported rovai://member-avatar reference"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use serde_json::Value;

    fn temporary_directory() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("member-avatar-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn write_test_png(path: &Path, color: [u8; 4]) {
        let image =
            DynamicImage::ImageRgba8(image::ImageBuffer::from_pixel(400, 500, image::Rgba(color)));
        fs::write(path, encode_png(&image).unwrap()).unwrap();
    }

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

    #[test]
    fn imports_four_by_five_image_with_lightweight_crop_and_deterministic_identity() {
        let directory = temporary_directory();
        let input = directory.join("portrait.png");
        write_test_png(&input, [24, 48, 96, 255]);
        let asset_id = Uuid::new_v4();

        let first = import_managed_member_avatar(&directory, asset_id, &input).unwrap();
        assert_eq!(first.source_width, 400);
        assert_eq!(first.source_height, 500);
        assert_eq!(first.crop.center_x, 0.5);
        assert!((first.crop.center_y - 0.45).abs() < f64::EPSILON);
        assert_eq!(first.crop.size, 1.0);
        assert_eq!(
            first.avatar_ref,
            format!("rovai://member-avatar/managed/{asset_id}")
        );
        let replay = import_managed_member_avatar(&directory, asset_id, &input).unwrap();
        assert_eq!(replay, first);

        let asset = directory.join("member-avatars").join(asset_id.to_string());
        let manifest: Value =
            serde_json::from_slice(&fs::read(asset.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["source"]["orientationNormalized"], true);
        assert_eq!(manifest["source"]["metadataStripped"], true);
        assert_eq!(manifest["icon"]["width"], ICON_EDGE);
        assert_eq!(manifest["icon"]["height"], ICON_EDGE);

        // Existing imported assets and normalized UI saves share the same reader.
        let portrait = read_managed_member_avatar(&directory, &first.avatar_ref, true)
            .unwrap()
            .unwrap();
        assert_eq!((portrait.width, portrait.height), (400, 500));
        let source = fs::read(
            directory
                .join("member-avatars")
                .join(asset_id.to_string())
                .join("source.png"),
        )
        .unwrap();
        let icon = fs::read(
            directory
                .join("member-avatars")
                .join(asset_id.to_string())
                .join("icon-192.png"),
        )
        .unwrap();
        let saved =
            save_managed_member_avatar(&directory, &source, &icon, 400, 500, first.crop.clone())
                .unwrap();
        let repeated =
            save_managed_member_avatar(&directory, &source, &icon, 400, 500, first.crop.clone())
                .unwrap();
        assert_eq!(saved, repeated);
        assert_eq!(
            read_managed_member_avatar(&directory, &saved.avatar_ref, false)
                .unwrap()
                .unwrap()
                .width,
            192
        );
        assert!(
            save_managed_member_avatar(&directory, &source, &icon, 500, 400, first.crop.clone())
                .is_err()
        );
        assert!(
            save_managed_member_avatar(
                &directory,
                &source,
                &icon,
                400,
                500,
                MemberAvatarCrop {
                    size: 2.0,
                    ..first.crop.clone()
                }
            )
            .is_err()
        );
        let cropped = recrop_member_avatar(
            &directory,
            &saved.avatar_ref,
            MemberAvatarCrop {
                center_x: 0.5,
                center_y: 0.5,
                size: 0.5,
            },
        )
        .unwrap();
        assert_ne!(cropped.avatar_ref, saved.avatar_ref);
        assert_eq!(
            member_avatar_bytes(&directory, &cropped.avatar_ref, true).unwrap(),
            source
        );
        assert!(
            recrop_member_avatar(
                &directory,
                &saved.avatar_ref,
                MemberAvatarCrop {
                    center_x: 0.0,
                    center_y: 0.5,
                    size: 1.0
                }
            )
            .is_err()
        );
        for avatar_ref in [
            LUOKE_AVATAR_REF,
            MUWA_AVATAR_REF,
            MIANZHI_AVATAR_REF,
            QILU_AVATAR_REF,
            &saved.avatar_ref,
        ] {
            for portrait in [false, true] {
                let path = materialize_member_avatar(&directory, &directory, avatar_ref, portrait)
                    .unwrap();
                assert!(Path::new(&path).is_file());
                assert!(Path::new(&path).starts_with(&directory));
                assert!(image::load_from_memory(&fs::read(path).unwrap()).is_ok());
            }
        }
        let builtin_crop = recrop_member_avatar(
            &directory,
            LUOKE_AVATAR_REF,
            MemberAvatarCrop {
                center_x: 0.5,
                center_y: 0.5,
                size: 0.5,
            },
        )
        .unwrap();
        assert_eq!(
            member_avatar_bytes(&directory, &builtin_crop.avatar_ref, true).unwrap(),
            member_avatar_bytes(&directory, LUOKE_AVATAR_REF, true).unwrap()
        );
        assert!(
            materialize_member_avatar(
                &directory,
                &directory.join("missing-run-tmp"),
                &saved.avatar_ref,
                true
            )
            .is_err()
        );
        let saved_id = saved.avatar_ref.rsplit('/').next().unwrap();
        fs::write(
            directory
                .join("member-avatars")
                .join(saved_id)
                .join("source.png"),
            b"changed",
        )
        .unwrap();
        assert!(read_managed_member_avatar(&directory, &saved.avatar_ref, true).is_err());

        write_test_png(&input, [96, 48, 24, 255]);
        let conflict = import_managed_member_avatar(&directory, asset_id, &input).unwrap_err();
        assert_eq!(
            conflict.kind,
            MemberAvatarImportErrorKind::CreationKeyConflict
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn animated_png_is_rejected_before_decode() {
        let directory = temporary_directory();
        let input = directory.join("animated.png");
        let mut bytes = encode_png(&DynamicImage::new_rgba8(300, 300)).unwrap();
        let animation_control = [
            0, 0, 0, 8, b'a', b'c', b'T', b'L', 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        bytes.splice(33..33, animation_control);
        fs::write(&input, bytes).unwrap();

        let error = import_managed_member_avatar(&directory, Uuid::new_v4(), &input).unwrap_err();

        assert_eq!(error.kind, MemberAvatarImportErrorKind::Invalid);
        assert!(error.to_string().contains("Animated PNG"));
        fs::remove_dir_all(directory).unwrap();
    }
}
