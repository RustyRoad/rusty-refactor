//! Binary entry point for testing the Rusty Refactor backend.
//!
//! The CLI also exposes small host-side helpers used by the VS Code
//! extension when a cancellable native process is a better boundary.

mod stt;
mod tts;

use anyhow::{Context, Result};
use std::io::Read;

/// Dispatches worker subcommands.
fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("tts") => speak_stdin(parse_voice_id(args)),
        Some("tts-voices") => print_voices(),
        Some("stt") => print_speech_recognition(),
        _ => print_usage(),
    }
}

/// Reads all stdin and speaks it with the native TTS engine.
fn speak_stdin(voice_id: Option<String>) -> Result<()> {
    let mut text = String::new();
    std::io::stdin()
        .read_to_string(&mut text)
        .context("failed to read TTS input")?;
    tts::speak_text(text.trim(), voice_id.as_deref())
}

/// Prints installed TTS voices as compact JSON.
fn print_voices() -> Result<()> {
    let voices = tts::list_voices()?;
    println!("{}", serde_json::to_string(&voices)?);
    Ok(())
}

/// Prints one microphone recognition result as compact JSON.
fn print_speech_recognition() -> Result<()> {
    let result = stt::recognize_once()?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

/// Extracts an optional voice id from worker command arguments.
fn parse_voice_id(args: impl Iterator<Item = String>) -> Option<String> {
    let mut pending_voice = false;

    for arg in args {
        if pending_voice {
            return Some(arg);
        }
        if arg == "--voice" {
            pending_voice = true;
        }
    }

    None
}

/// Prints worker usage for manual command-line runs.
fn print_usage() -> Result<()> {
    println!("Rusty Refactor Worker");
    println!("Commands:");
    println!("  tts [--voice <id>]    Read stdin aloud with native TTS");
    println!("  tts-voices            Print installed native TTS voices");
    println!("  stt                   Capture one utterance as text");
    println!("For testing, use: cargo test");
    Ok(())
}
