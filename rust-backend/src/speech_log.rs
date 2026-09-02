//! Persistent diagnostics for local Windows speech handoff.

use anyhow::{Context, Result};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// Clears the speech diagnostic log for a new Read request.
pub fn reset() -> Result<()> {
    File::create(log_path())
        .context("failed to reset speech diagnostic log")?;
    Ok(())
}

/// Appends one diagnostic event to the local speech log.
pub fn append(message: &str) -> Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
        .context("failed to open speech diagnostic log")?;
    writeln!(file, "{message}")
        .context("failed to write speech diagnostic log")
}

/// Returns the per-user temporary speech diagnostic path.
fn log_path() -> PathBuf {
    std::env::temp_dir().join("rusty-refactor-speech.log")
}
