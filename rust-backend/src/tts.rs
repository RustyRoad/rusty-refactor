//! Native text-to-speech support for the Rusty Refactor worker.
//!
//! Windows uses WinRT speech synthesis through the `windows` crate. Other
//! platforms return a clear unsupported error so the extension can degrade
//! cleanly.

use anyhow::Result;
use serde::Serialize;
use std::path::Path;

/// Describes one installed text-to-speech voice.
#[derive(Debug, Clone, Serialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub natural: bool,
}

/// Speaks text with the best available system voice.
pub fn speak_text(text: &str, voice_id: Option<&str>) -> Result<()> {
    platform::speak_text(text, voice_id)
}

/// Lists installed text-to-speech voices.
pub fn list_voices() -> Result<Vec<VoiceInfo>> {
    platform::list_voices()
}

/// Plays existing WAV audio without replacing its original synthesizer.
pub fn play_wav_path(path: &Path) -> Result<()> {
    platform::play_wav_path(path)
}

/// Plays in-memory WAV audio without changing its synthesizer.
pub fn play_wav_bytes(bytes: &[u8]) -> Result<()> {
    platform::play_wav_bytes(bytes)
}

#[cfg(windows)]
mod platform {
    use super::VoiceInfo;
    use anyhow::{bail, Context, Result};
    use std::fs;
    use std::path::{Path, PathBuf};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Media::SpeechSynthesis::{
        SpeechSynthesisStream,
        SpeechSynthesizer,
        VoiceInformation,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Media::Audio::{
        PlaySoundW,
        SND_FILENAME,
        SND_NODEFAULT,
        SND_SYNC,
    };
    use windows::Win32::System::WinRT::{
        RoInitialize,
        RoUninitialize,
        RO_INIT_MULTITHREADED,
    };

    /// Initializes WinRT for the current thread and cleans it up on drop.
    struct WinRtApartment;

    impl WinRtApartment {
        /// Enters a multithreaded WinRT apartment for synthesis calls.
        fn enter() -> Result<Self> {
            unsafe {
                RoInitialize(RO_INIT_MULTITHREADED)
                    .ok()
                    .context("failed to initialize WinRT for speech")?;
            }
            Ok(Self)
        }
    }

    impl Drop for WinRtApartment {
        /// Leaves the WinRT apartment created for speech synthesis.
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }

    /// Speaks text using Windows WinRT speech synthesis.
    pub fn speak_text(text: &str, voice_id: Option<&str>) -> Result<()> {
        let _apartment = WinRtApartment::enter()?;
        let synthesizer = SpeechSynthesizer::new()
            .context("failed to create Windows speech synthesizer")?;
        choose_voice(&synthesizer, voice_id)?;
        let stream = synthesize_stream(&synthesizer, text)?;
        play_stream(stream)
    }

    /// Lists voices visible through the WinRT speech synthesizer.
    pub fn list_voices() -> Result<Vec<VoiceInfo>> {
        let _apartment = WinRtApartment::enter()?;
        let voices = installed_voices()?;

        voices.iter().map(voice_info).collect()
    }

    /// Plays an existing WAV through the active Windows output device.
    pub fn play_wav_path(path: &Path) -> Result<()> {
        if !path.is_file() {
            bail!("speech WAV file was not found");
        }
        play_wav_file(path)
    }

    /// Writes and plays in-memory WAV bytes through the active device.
    pub fn play_wav_bytes(bytes: &[u8]) -> Result<()> {
        let path = temp_wav_path();
        fs::write(&path, bytes).context("failed to write speech audio")?;
        let play_result = play_wav_file(&path);
        let _ = fs::remove_file(&path);
        play_result
    }

    /// Selects the requested voice or a natural-preferred fallback.
    fn choose_voice(
        synthesizer: &SpeechSynthesizer,
        voice_id: Option<&str>,
    ) -> Result<()> {
        let voices = installed_voices()?;
        let requested = voice_id.unwrap_or("").trim();

        if !requested.is_empty() {
            if let Some(voice) = matching_voice(&voices, requested)? {
                synthesizer
                    .SetVoice(&voice)
                    .context("failed to select Windows speech voice")?;
                return Ok(());
            }
            bail!("selected Windows speech voice was not found");
        }

        if let Some(voice) = best_voice(voices)? {
            synthesizer
                .SetVoice(&voice)
                .context("failed to select Windows speech voice")?;
        }
        Ok(())
    }

    /// Returns all voices reported by the WinRT synthesizer.
    fn installed_voices() -> Result<Vec<VoiceInformation>> {
        let view = SpeechSynthesizer::AllVoices()
            .context("failed to list Windows speech voices")?;
        let count = view
            .Size()
            .context("failed to count Windows speech voices")?;
        let mut tokens = Vec::new();

        for index in 0..count {
            tokens.push(
                view.GetAt(index)
                    .context("failed to read Windows speech voice")?,
            );
        }

        Ok(tokens)
    }

    /// Finds a voice whose id or displayed name matches user selection.
    fn matching_voice(
        voices: &[VoiceInformation],
        requested: &str,
    ) -> Result<Option<VoiceInformation>> {
        for voice in voices {
            let info = voice_info(voice)?;
            if info.id == requested || info.name == requested {
                return Ok(Some(voice.clone()));
            }
        }

        Ok(None)
    }

    /// Returns the most natural installed voice with a first-voice fallback.
    fn best_voice(
        voices: Vec<VoiceInformation>,
    ) -> Result<Option<VoiceInformation>> {
        let mut fallback = None;

        for voice in voices {
            if fallback.is_none() {
                fallback = Some(voice.clone());
            }
            if voice_info(&voice)?.natural {
                return Ok(Some(voice));
            }
        }

        Ok(fallback)
    }

    /// Converts one WinRT voice into a serializable voice description.
    fn voice_info(voice: &VoiceInformation) -> Result<VoiceInfo> {
        let id = hstring_to_string(voice.Id()?);
        let display_name = hstring_to_string(voice.DisplayName()?);
        let description = hstring_to_string(voice.Description()?);
        let language = hstring_to_string(voice.Language()?);
        let name = voice_name(&display_name, &description, &language);
        let search = format!("{id} {name} {display_name} {description}");

        Ok(VoiceInfo {
            id,
            natural: is_natural_voice(&search),
            name,
        })
    }

    /// Chooses the most descriptive human label for a voice.
    fn voice_name(
        display_name: &str,
        description: &str,
        language: &str,
    ) -> String {
        if !description.is_empty() {
            return description.to_string();
        }
        if !display_name.is_empty() && !language.is_empty() {
            return format!("{display_name} ({language})");
        }

        if display_name.is_empty() {
            "Windows speech voice".to_string()
        } else {
            display_name.to_string()
        }
    }

    /// Scores whether a voice name is likely to be a natural voice.
    fn is_natural_voice(name: &str) -> bool {
        let lower = name.to_lowercase();
        [
            "natural",
            "neural",
            "aria",
            "jenny",
            "guy",
            "ava",
            "andrew",
            "emma",
            "brian",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
    }

    /// Synthesizes the requested text into a WinRT audio stream.
    fn synthesize_stream(
        synthesizer: &SpeechSynthesizer,
        text: &str,
    ) -> Result<SpeechSynthesisStream> {
        let text = HSTRING::from(text);
        synthesizer
            .SynthesizeTextToStreamAsync(&text)
            .context("failed to start Windows speech synthesis")?
            .get()
            .context("Windows speech synthesis failed")
    }

    /// Plays a synthesized stream through WinMM as a temporary WAV file.
    fn play_stream(stream: SpeechSynthesisStream) -> Result<()> {
        let bytes = stream_bytes(&stream)?;
        play_wav_bytes(&bytes)
    }

    /// Reads the entire speech stream into memory.
    fn stream_bytes(stream: &SpeechSynthesisStream) -> Result<Vec<u8>> {
        let size = stream.Size().context("failed to size speech audio")?;
        let count = u32::try_from(size)
            .context("speech audio was too large to play")?;
        let input = stream
            .GetInputStreamAt(0)
            .context("failed to read speech audio stream")?;
        let reader = DataReader::CreateDataReader(&input)
            .context("failed to create speech audio reader")?;
        let loaded = reader
            .LoadAsync(count)
            .context("failed to load speech audio")?
            .get()
            .context("failed to load speech audio")?;
        let mut bytes = vec![0; loaded as usize];
        reader
            .ReadBytes(&mut bytes)
            .context("failed to copy speech audio")?;
        Ok(bytes)
    }

    /// Returns a collision-resistant temporary WAV path for playback.
    fn temp_wav_path() -> PathBuf {
        let mut path = std::env::temp_dir();
        let process = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        path.push(format!("rusty-refactor-tts-{process}-{nanos}.wav"));
        path
    }

    /// Blocks until WinMM finishes playing a WAV file.
    fn play_wav_file(path: &Path) -> Result<()> {
        let wide = wide_null(&path.to_string_lossy());
        let flags = SND_FILENAME | SND_NODEFAULT | SND_SYNC;
        let played = unsafe {
            PlaySoundW(
                PCWSTR(wide.as_ptr()),
                HMODULE::default(),
                flags,
            )
        };

        if played.as_bool() {
            Ok(())
        } else {
            bail!("Windows speech audio playback failed")
        }
    }

    /// Converts a WinRT string into a Rust-owned UTF-8 string.
    fn hstring_to_string(value: HSTRING) -> String {
        value.to_string()
    }

    /// Keeps a generated buffer alive while WinMM reads a path string.
    fn wide_null(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(not(windows))]
mod platform {
    use super::VoiceInfo;
    use anyhow::{bail, Result};
    use std::path::Path;

    /// Returns unsupported outside Windows for this native implementation.
    pub fn speak_text(_text: &str, _voice_id: Option<&str>) -> Result<()> {
        bail!("native Rust TTS is currently implemented for Windows")
    }

    /// Returns no voices outside Windows.
    pub fn list_voices() -> Result<Vec<VoiceInfo>> {
        Ok(Vec::new())
    }

    /// Returns unsupported for native WAV playback outside Windows.
    pub fn play_wav_path(_path: &Path) -> Result<()> {
        bail!("native WAV playback is currently implemented for Windows")
    }

    /// Returns unsupported for in-memory WAV playback outside Windows.
    pub fn play_wav_bytes(_bytes: &[u8]) -> Result<()> {
        bail!("native WAV playback is currently implemented for Windows")
    }
}
