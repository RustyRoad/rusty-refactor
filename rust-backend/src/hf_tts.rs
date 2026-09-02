//! Hugging Face text-to-speech HTTP transport.

use anyhow::{Context, Result};
use serde::Serialize;
use std::io::Read;
use std::time::Duration;

/// Describes the JSON body accepted by the configured TTS service.
#[derive(Serialize)]
struct SpeechRequest<'a> {
    script: &'a str,
    language: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    voice_id: Option<&'a str>,
}

/// Requests one WAV from the configured Hugging Face TTS service.
pub fn synthesize(
    server_url: &str,
    voice_id: &str,
    text: &str,
) -> Result<Vec<u8>> {
    let endpoint = format!(
        "{}/tts/speak",
        server_url.trim_end_matches('/')
    );
    let request = SpeechRequest {
        script: text,
        language: "english",
        voice_id: nonempty_voice(voice_id),
    };
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(90))
        .build();
    let response = agent
        .post(&endpoint)
        .send_json(request)
        .context("Hugging Face speech request failed")?;
    let mut audio = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut audio)
        .context("failed to read Hugging Face speech audio")?;
    anyhow::ensure!(!audio.is_empty(), "Hugging Face returned empty audio");
    Ok(audio)
}

/// Omits an empty voice so the service can apply its default.
fn nonempty_voice(voice_id: &str) -> Option<&str> {
    let voice_id = voice_id.trim();
    if voice_id.is_empty() {
        None
    } else {
        Some(voice_id)
    }
}
