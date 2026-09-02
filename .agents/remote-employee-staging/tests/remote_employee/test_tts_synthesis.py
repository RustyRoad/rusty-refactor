import io
import wave

import pytest

from apps.remote_employee.tts_synthesis import (
    LocalTtsClient,
    decode_wav,
    local_voice,
)


def wav_bytes(data=b"a" * 960, rate=24000):
    """Build one valid mono PCM WAV for decoder tests."""
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(data)
    return output.getvalue()


def test_decodes_kokoro_wav_to_livekit_pcm():
    """Verify WAV framing is removed without changing audio bytes."""
    audio = decode_wav(wav_bytes())
    assert audio.rate == 24000
    assert audio.data == b"a" * 960


def test_maps_persisted_voice_names_to_kokoro():
    """Keep existing employee profiles valid through the migration."""
    assert local_voice("Charon") == "am_onyx"
    assert local_voice("Kore") == "af_kore"
    assert local_voice("af_heart") == "af_heart"


def test_rejects_non_loopback_tts_endpoint():
    """Prevent narration text from being posted to an external service."""
    with pytest.raises(ValueError, match="loopback"):
        LocalTtsClient("https://example.com")
