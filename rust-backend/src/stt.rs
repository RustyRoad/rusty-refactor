//! Native speech-to-text support for the Rusty Refactor worker.
//!
//! Windows uses WinRT speech recognition through the `windows` crate. Other
//! platforms return a clear unsupported error so the extension can degrade
//! cleanly.

use anyhow::Result;
use serde::Serialize;

/// Result produced by one microphone recognition attempt.
#[derive(Debug, Clone, Serialize)]
pub struct SpeechRecognitionInfo {
    pub text: String,
    pub confidence: String,
    pub status: String,
}

/// Captures one utterance from the default microphone.
pub fn recognize_once() -> Result<SpeechRecognitionInfo> {
    platform::recognize_once()
}

#[cfg(windows)]
mod platform {
    use super::SpeechRecognitionInfo;
    use anyhow::{bail, Context, Result};
    use windows::core::HSTRING;
    use windows::Media::SpeechRecognition::{
        SpeechRecognitionConfidence,
        SpeechRecognitionResult,
        SpeechRecognitionResultStatus,
        SpeechRecognitionScenario,
        SpeechRecognitionTopicConstraint,
        SpeechRecognizer,
    };
    use windows::Win32::System::WinRT::{
        RoInitialize,
        RoUninitialize,
        RO_INIT_MULTITHREADED,
    };

    /// Initializes WinRT for the current thread and cleans it up on drop.
    struct WinRtApartment;

    impl WinRtApartment {
        /// Enters a multithreaded WinRT apartment for recognition calls.
        fn enter() -> Result<Self> {
            unsafe {
                RoInitialize(RO_INIT_MULTITHREADED)
                    .ok()
                    .context("failed to initialize WinRT for recognition")?;
            }
            Ok(Self)
        }
    }

    impl Drop for WinRtApartment {
        /// Leaves the WinRT apartment created for speech recognition.
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }

    /// Captures one utterance with Windows WinRT speech recognition.
    pub fn recognize_once() -> Result<SpeechRecognitionInfo> {
        let _apartment = WinRtApartment::enter()?;
        let recognizer = SpeechRecognizer::new()
            .context("failed to create Windows speech recognizer")?;
        add_dictation_constraint(&recognizer)?;
        compile_constraints(&recognizer)?;
        let result = recognizer
            .RecognizeAsync()
            .context("failed to start Windows speech recognition")?
            .get()
            .context("Windows speech recognition failed")?;
        recognition_info(&result)
    }

    /// Adds a dictation topic so arbitrary chat prompts can be recognized.
    fn add_dictation_constraint(recognizer: &SpeechRecognizer) -> Result<()> {
        let topic = HSTRING::from("Codetether chat prompt");
        let constraint = SpeechRecognitionTopicConstraint::Create(
            SpeechRecognitionScenario::Dictation,
            &topic,
        )
        .context("failed to create dictation speech constraint")?;
        recognizer
            .Constraints()
            .context("failed to read speech recognition constraints")?
            .Append(&constraint)
            .context("failed to add dictation speech constraint")
    }

    /// Compiles recognition constraints before microphone capture begins.
    fn compile_constraints(recognizer: &SpeechRecognizer) -> Result<()> {
        let result = recognizer
            .CompileConstraintsAsync()
            .context("failed to compile speech constraints")?
            .get()
            .context("failed to compile speech constraints")?;
        let status = result.Status()?;
        ensure_success(status, "speech constraint compilation")
    }

    /// Converts the raw Windows recognition result to serializable data.
    fn recognition_info(
        result: &SpeechRecognitionResult,
    ) -> Result<SpeechRecognitionInfo> {
        let status = result.Status()?;
        ensure_success(status, "speech recognition")?;
        let text = result.Text()?.to_string().trim().to_string();
        if text.is_empty() {
            bail!("speech recognition returned no text");
        }

        Ok(SpeechRecognitionInfo {
            text,
            confidence: confidence_label(result.Confidence()?),
            status: status_label(status).to_string(),
        })
    }

    /// Fails when Windows returns a non-success recognition status.
    fn ensure_success(
        status: SpeechRecognitionResultStatus,
        action: &str,
    ) -> Result<()> {
        if status == SpeechRecognitionResultStatus::Success {
            return Ok(());
        }

        bail!("{action} failed: {}", status_label(status))
    }

    /// Returns a compact label for a recognition status value.
    fn status_label(status: SpeechRecognitionResultStatus) -> &'static str {
        match status {
            SpeechRecognitionResultStatus::Success => "success",
            SpeechRecognitionResultStatus::TopicLanguageNotSupported => {
                "topic-language-not-supported"
            }
            SpeechRecognitionResultStatus::GrammarLanguageMismatch => {
                "grammar-language-mismatch"
            }
            SpeechRecognitionResultStatus::GrammarCompilationFailure => {
                "grammar-compilation-failure"
            }
            SpeechRecognitionResultStatus::AudioQualityFailure => {
                "audio-quality-failure"
            }
            SpeechRecognitionResultStatus::UserCanceled => "user-canceled",
            SpeechRecognitionResultStatus::Unknown => "unknown",
            SpeechRecognitionResultStatus::TimeoutExceeded => {
                "timeout-exceeded"
            }
            SpeechRecognitionResultStatus::PauseLimitExceeded => {
                "pause-limit-exceeded"
            }
            SpeechRecognitionResultStatus::NetworkFailure => {
                "network-failure"
            }
            SpeechRecognitionResultStatus::MicrophoneUnavailable => {
                "microphone-unavailable"
            }
            _ => "unrecognized-status",
        }
    }

    /// Returns a compact label for confidence shown in logs if needed.
    fn confidence_label(confidence: SpeechRecognitionConfidence) -> String {
        match confidence {
            SpeechRecognitionConfidence::High => "high",
            SpeechRecognitionConfidence::Medium => "medium",
            SpeechRecognitionConfidence::Low => "low",
            SpeechRecognitionConfidence::Rejected => "rejected",
            _ => "unknown",
        }
        .to_string()
    }
}

#[cfg(not(windows))]
mod platform {
    use super::SpeechRecognitionInfo;
    use anyhow::{bail, Result};

    /// Returns unsupported outside Windows for this native implementation.
    pub fn recognize_once() -> Result<SpeechRecognitionInfo> {
        bail!("native Rust STT is currently implemented for Windows")
    }
}
