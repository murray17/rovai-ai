use super::*;
#[cfg(unix)]
use std::{collections::HashMap, fs};
#[cfg(unix)]
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// Owns release admission and action fencing; no Core/database/model fixture is needed.
#[test]
fn release_coordinates_and_checksums_admit_only_exact_stable_server_assets() {
    for (text, expected) in [
        ("0.2.6", Some([0, 2, 6])),
        ("10.20.30", Some([10, 20, 30])),
        ("v1.2.3", None),
        ("01.2.3", None),
        ("1.2.3-beta", None),
        ("1.2", None),
        ("1.2.3/other", None),
    ] {
        assert_eq!(version_numbers(text), expected);
    }
    let asset = asset_name("0.2.7", "macos-arm64");
    let digest = "a".repeat(64);
    assert_eq!(
        checksum(&format!("{digest}  {asset}\n"), &asset).unwrap(),
        digest
    );
    for text in [
        format!("{digest}  Rovai-AI.dmg\n"),
        format!("{digest}  {asset}\n{digest}  {asset}\n"),
        format!("bad  {asset}"),
    ] {
        assert!(checksum(&text, &asset).is_err());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn update_pipeline_keeps_the_running_program_until_verified_and_durably_settled() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = std::env::temp_dir().join(format!(
        "rovai-update-test-{}",
        rovai_web::new_token().unwrap()
    ));
    fs::create_dir(&fixture).unwrap();
    let root = fixture.join("program");
    let data = fixture.join("data");
    let package = fixture.join("payload/rovai-server");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&data).unwrap();
    fs::create_dir_all(package.join("web-ui")).unwrap();
    let target = target().unwrap();
    let version = "999.0.0";
    let current_version = env!("CARGO_PKG_VERSION");
    let old = format!(
        "schema=1\nversion={}\ntarget={target}\n",
        env!("CARGO_PKG_VERSION")
    );
    fs::write(root.join("package-info"), &old).unwrap();
    let nested_data = root.join("data");
    fs::create_dir(&nested_data).unwrap();
    let alias = fixture.join("program-alias");
    std::os::unix::fs::symlink(&root, &alias).unwrap();
    assert!(
        install::prepare(
            &root,
            &alias.join("data"),
            &fixture,
            version,
            target,
            &"a".repeat(64),
            vec![]
        )
        .err()
        .unwrap()
        .to_string()
        .contains("outside its program directory")
    );
    fs::write(data.join("sentinel"), "retained data").unwrap();
    fs::write(
        package.join("package-info"),
        format!("schema=1\nversion={version}\ntarget={target}\n"),
    )
    .unwrap();
    fs::write(package.join("web-ui/index.html"), "new matching UI").unwrap();
    for program in ["rovai-server", "rovai-host", "rovai"] {
        fs::write(
            package.join(program),
            format!("#!/bin/sh\nprintf '%s\\n' 'rovai-server {version}'\n"),
        )
        .unwrap();
        fs::set_permissions(package.join(program), fs::Permissions::from_mode(0o755)).unwrap();
    }
    let archive = fixture.join("package.tar.gz");
    assert!(
        std::process::Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(fixture.join("payload"))
            .arg("rovai-server")
            .status()
            .unwrap()
            .success()
    );
    let bytes = fs::read(archive).unwrap();
    let asset = asset_name(version, target);
    let response = json!({"tag_name":format!("server-v{version}"),"draft":false,"prerelease":false,"name":"Fixture","body":"Changes","published_at":"2026-09-14T00:00:00Z",
        "assets":[{"name":asset,"size":bytes.len()},{"name":"SHA256SUMS","size":100}]});
    let current_response = json!({"tag_name":format!("server-v{current_version}"),"draft":false,"prerelease":false,"name":"Installed Fixture","body":"Installed changes","published_at":"2026-09-14T00:00:00Z",
        "assets":[{"name":asset_name(current_version, target),"size":1},{"name":"SHA256SUMS","size":100}]});
    let routes = Arc::new(Mutex::new(HashMap::from([
        ("/channel".to_owned(), b"unpublished".to_vec()),
        (
            format!("/api/server-v{version}"),
            serde_json::to_vec(&response).unwrap(),
        ),
        (
            format!("/api/server-v{current_version}"),
            serde_json::to_vec(&current_response).unwrap(),
        ),
        (format!("/assets/server-v{version}/{asset}"), bytes.clone()),
        (
            format!("/assets/server-v{version}/SHA256SUMS"),
            format!("{}  {asset}\n", "0".repeat(64)).into_bytes(),
        ),
    ])));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let entries = routes.clone();
    let server = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let length = socket.read(&mut request).await.unwrap();
            let path = std::str::from_utf8(&request[..length])
                .unwrap()
                .split_whitespace()
                .nth(1)
                .unwrap_or("");
            let body = entries.lock().unwrap().get(path).cloned();
            let status = if body.is_some() {
                "200 OK"
            } else {
                "404 Not Found"
            };
            let body = body.unwrap_or_default();
            let header = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            socket.write_all(header.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
        }
    });
    let mut updates = ServerUpdates::new(&data, vec![]).unwrap();
    let inner = Arc::get_mut(&mut updates.0).unwrap();
    inner.root = root.clone();
    inner.sources = Sources {
        channel: format!("{origin}/channel"),
        api: format!("{origin}/api"),
        releases: format!("{origin}/assets"),
    };
    updates.call(UpdateRequest::Check {}).await.unwrap();
    wait_status(&updates, "check_failed").await;
    assert_eq!(updates.snapshot()["failureReason"], "release_unpublished");
    routes
        .lock()
        .unwrap()
        .insert("/channel".into(), current_version.as_bytes().to_vec());
    updates.call(UpdateRequest::Check {}).await.unwrap();
    wait_status(&updates, "up_to_date").await;
    assert_eq!(
        updates.snapshot()["currentRelease"]["version"],
        current_version
    );
    assert_eq!(
        updates.snapshot()["currentRelease"]["releaseNotes"],
        "Installed changes"
    );
    assert!(updates.snapshot()["availableRelease"].is_null());
    routes
        .lock()
        .unwrap()
        .insert("/channel".into(), version.as_bytes().to_vec());
    updates.call(UpdateRequest::Check {}).await.unwrap();
    wait_status(&updates, "available").await;
    assert_eq!(updates.snapshot()["availableRelease"]["version"], version);
    assert_eq!(
        updates.snapshot()["currentRelease"]["version"],
        current_version
    );
    routes
        .lock()
        .unwrap()
        .insert("/channel".into(), b"unpublished".to_vec());
    updates.call(UpdateRequest::Check {}).await.unwrap();
    wait_status(&updates, "check_failed").await;
    assert_eq!(updates.snapshot()["availableRelease"]["version"], version);
    routes
        .lock()
        .unwrap()
        .insert("/channel".into(), version.as_bytes().to_vec());
    updates.call(UpdateRequest::Check {}).await.unwrap();
    wait_status(&updates, "available").await;
    assert!(
        updates
            .call(UpdateRequest::Download {
                version: "other".into()
            })
            .await
            .is_err()
    );
    assert!(
        updates
            .call(UpdateRequest::Install {
                version: version.into()
            })
            .await
            .is_err()
    );
    updates
        .call(UpdateRequest::Download {
            version: version.into(),
        })
        .await
        .unwrap();
    assert_eq!(
        updates
            .call(UpdateRequest::Download {
                version: version.into()
            })
            .await
            .unwrap()["status"],
        "downloading"
    );
    wait_status(&updates, "download_failed").await;
    assert_eq!(fs::read_to_string(root.join("package-info")).unwrap(), old);
    routes.lock().unwrap().insert(
        format!("/assets/server-v{version}/SHA256SUMS"),
        format!("{:x}  {asset}\n", Sha256::digest(&bytes)).into_bytes(),
    );
    updates
        .call(UpdateRequest::Download {
            version: version.into(),
        })
        .await
        .unwrap();
    wait_status(&updates, "ready_to_install").await;
    assert_eq!(updates.snapshot()["downloadPercent"], 100.0);
    assert!(
        updates
            .call(UpdateRequest::Install {
                version: "other".into()
            })
            .await
            .is_err()
    );
    updates
        .call(UpdateRequest::Install {
            version: version.into(),
        })
        .await
        .unwrap();
    assert_eq!(updates.snapshot()["status"], "installing");
    updates.finish(false).unwrap(); // The Core settlement failure must never switch files.
    assert_eq!(fs::read_to_string(root.join("package-info")).unwrap(), old);
    assert_eq!(
        fs::read_to_string(data.join("sentinel")).unwrap(),
        "retained data"
    );
    server.abort();
    drop(updates);
    fs::remove_dir_all(fixture).unwrap();
}
#[cfg(unix)]
async fn wait_status(updates: &ServerUpdates, expected: &str) {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let snapshot = updates.snapshot();
            if snapshot["status"] == expected {
                break;
            }
            assert!(
                matches!(
                    snapshot["status"].as_str(),
                    Some("checking" | "downloading")
                ),
                "unexpected {snapshot}"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
