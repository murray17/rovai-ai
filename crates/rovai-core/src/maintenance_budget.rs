//! A finite allowance for best-effort filesystem maintenance, never a readiness gate.
use std::time::{Duration, Instant};

pub struct MaintenanceBudget {
    deadline: Instant,
    remaining: usize,
    diagnostics: usize,
}

impl MaintenanceBudget {
    pub fn new(entries: usize, duration: Duration) -> Self {
        Self {
            deadline: Instant::now() + duration,
            remaining: entries,
            diagnostics: 0,
        }
    }

    pub fn take(&mut self) -> bool {
        if self.remaining == 0 || Instant::now() >= self.deadline {
            return false;
        }
        self.remaining -= 1;
        true
    }

    pub fn report(&mut self, stage: &str, error: impl std::fmt::Display) {
        if self.diagnostics < 16 {
            let message: String = error.to_string().chars().take(512).collect();
            eprintln!("Maintenance {stage} skipped: {message}");
            self.diagnostics += 1;
        }
    }
}

/// Only callers that already proved ownership may remove a tree. Enumeration,
/// recursion and deletion all consume the same allowance; partial work is safe
/// to leave behind. No symlink is followed and unknown node kinds are retained.
pub fn remove_owned_tree(
    path: &std::path::Path,
    budget: &mut MaintenanceBudget,
) -> anyhow::Result<bool> {
    fn remove(
        path: &std::path::Path,
        budget: &mut MaintenanceBudget,
        depth: usize,
    ) -> anyhow::Result<bool> {
        if !budget.take() || depth > 16 {
            return Ok(false);
        }
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(true),
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            if metadata.is_file() {
                std::fs::remove_file(path)?;
                return Ok(true);
            }
            return Ok(false);
        }
        for entry in std::fs::read_dir(path)? {
            if !budget.take() {
                return Ok(false);
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    budget.report("directory entry", error);
                    continue;
                }
            };
            match remove(&entry.path(), budget, depth + 1) {
                Ok(true) => {}
                Ok(false) => {}
                Err(error) => budget.report("file removal", error),
            }
        }
        match std::fs::remove_dir(path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => Ok(false),
            Err(error) => Err(error.into()),
        }
    }
    remove(path, budget, 0)
}
