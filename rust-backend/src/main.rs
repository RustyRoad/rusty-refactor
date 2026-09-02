//! Binary entry point for testing the Rusty Refactor backend.
//!
//! The CLI also exposes small host-side helpers used by the VS Code
//! extension when a cancellable native process is a better boundary.

mod hf_tts;
mod speech_log;
mod stt;
mod tts;

use anyhow::{Context, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::io::Read;

/// Dispatches worker subcommands.
fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("tts") => speak_stdin(parse_voice_id(args)),
        Some("hf-tts") => speak_hf(args),
        Some("play-wav") => play_wav_file(args.next()),
        Some("tts-voices") => print_voices(),
        Some("stt") => print_speech_recognition(),
        _ => print_usage(),
    }
}

/// Synthesizes encoded text chunks with HF and plays them on Windows.
fn speak_hf(mut args: impl Iterator<Item = String>) -> Result<()> {
    speech_log::reset()?;
    let result = execute_hf_speech(&mut args);
    if let Err(error) = &result {
        let _ = speech_log::append(&format!("error={error:#}"));
    }
    result
}

/// Decodes and processes one native HF speech command.
fn execute_hf_speech(
    args: &mut impl Iterator<Item = String>,
) -> Result<()> {
    let server_url = decode_argument(args.next(), "server URL")?;
    let voice_id = decode_argument(args.next(), "voice id")?;
    let chunks = args
        .map(|value| decode_argument(Some(value), "speech chunk"))
        .collect::<Result<Vec<_>>>()?;
    anyhow::ensure!(!chunks.is_empty(), "hf-tts requires speech text");
    speech_log::append("started")?;

    for (index, text) in chunks.iter().enumerate() {
        let audio = hf_tts::synthesize(
            &server_url,
            &voice_id,
            text,
        )?;
        speech_log::append(&format!(
            "chunk={} downloaded={}",
            index + 1,
            audio.len()
        ))?;
        tts::play_wav_bytes(&audio)?;
        speech_log::append(&format!("chunk={} played", index + 1))?;
    }
    Ok(())
}

/// Decodes one required Base64 UTF-8 worker argument.
fn decode_argument(value: Option<String>, label: &str) -> Result<String> {
    let value = value.with_context(|| format!("hf-tts requires {label}"))?;
    let bytes = STANDARD
        .decode(value)
        .with_context(|| format!("invalid encoded {label}"))?;
    String::from_utf8(bytes)
        .with_context(|| format!("invalid UTF-8 {label}"))
}

/// Plays one WAV file through the native Windows audio device.
fn play_wav_file(path: Option<String>) -> Result<()> {
    let path = path.context("play-wav requires a WAV file path")?;
    tts::play_wav_path(std::path::Path::new(&path))
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
    println!("  play-wav <path>       Play WAV audio through Windows");
    println!("  hf-tts <url> <voice> <chunks...>  Play HF speech");
    println!("  tts-voices            Print installed native TTS voices");
    println!("  stt                   Capture one utterance as text");
    println!("For testing, use: cargo test");
    Ok(())
}
