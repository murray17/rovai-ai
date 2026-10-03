//! Read an audited embedded resource from the selected native executable.
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub(super) fn embedded_json(
    executable: &Path,
    marker: &[u8],
    expected_digest: &str,
    runtime: &str,
) -> Result<Value> {
    let mut file = File::open(executable).context("无法读取所选运行时程序的原生目录。")?;
    let mut scan = Vec::new();
    let mut block = [0_u8; 64 * 1024];
    let mut found = false;
    let mut total = 0_usize;
    loop {
        let read = file.read(&mut block)?;
        if read == 0 {
            break;
        }
        total += read;
        ensure!(
            total <= 512 * 1024 * 1024,
            "所选运行时程序超出目录读取范围。"
        );
        scan.extend_from_slice(&block[..read]);
        if !found {
            if let Some(position) = scan.windows(marker.len()).position(|bytes| bytes == marker) {
                scan.drain(..position);
                found = true;
            } else {
                let retain = scan.len().saturating_sub(marker.len());
                scan.drain(..retain);
                continue;
            }
        }
        ensure!(scan.len() <= 2 * 1024 * 1024, "原生目录超出受支持大小。");
        let mut stream = serde_json::Deserializer::from_slice(&scan).into_iter::<Value>();
        match stream.next() {
            Some(Ok(catalog)) => {
                let digest = format!("{:x}", Sha256::digest(&scan[..stream.byte_offset()]));
                ensure!(
                    digest == expected_digest,
                    "此原生目录尚未适配；当前适配依据为 {runtime}，请使用兼容版本或关闭自定义 API。"
                );
                return Ok(catalog);
            }
            Some(Err(error)) if error.is_eof() => continue,
            _ => anyhow::bail!("所选运行时程序的原生目录无法解析。"),
        }
    }
    anyhow::bail!(
        "所选运行时程序未提供可读取的完整原生目录；当前适配依据为 {runtime}，请使用兼容原生程序或关闭自定义 API。"
    )
}
