"""Synthesize mono PCM through the local CUDA Kokoro service."""

from __future__ import annotations

import asyncio
import io
import json
import os
import urllib.request
import wave

from dataclasses import dataclass
from urllib.parse import urlparse


MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX"
DEFAULT_ENDPOINT = "http://127.0.0.1:8016"
MAXIMUM_AUDIO_BYTES = 32 * 1024 * 1024
LOCAL_VOICES = {
    "af_heart",
    "af_aoede",
    "af_bella",
    "af_kore",
    "af_nova",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_michael",
    "am_onyx",
    "am_puck",
    "bf_emma",
    "bm_george",
    "bm_lewis",
}
PERSISTED_VOICES = {
    "Aoede": "af_aoede",
    "Charon": "am_onyx",
    "Fenrir": "am_fenrir",
    "Kore": "af_kore",
    "Puck": "am_puck",
    "Zephyr": "af_sky",
    "Leda": "af_nova",
    "Orus": "am_michael",
    "Achernar": "am_echo",
    "Algenib": "am_adam",
    "Callirrhoe": "af_bella",
    "Despina": "af_sarah",
    "Gacrux": "bm_george",
    "Iapetus": "bm_lewis",
    "Pulcherrima": "bf_emma",
    "Schedar": "am_eric",
}


@dataclass(frozen=True)
class PcmAudio:
    """Complete mono PCM audio decoded from one Kokoro WAV response."""

    data: bytes
    rate: int


class LocalTtsClient:
    """Bounded HTTP client for the loopback-only Kokoro service."""

    def __init__(self, endpoint: str, timeout: float = 90) -> None:
        """Validate and retain one loopback TTS endpoint."""
        parsed = urlparse(endpoint.rstrip("/"))
        if parsed.scheme != "http" or parsed.hostname not in {
            "127.0.0.1",
            "localhost",
            "::1",
        }:
            raise ValueError("Remote Employee TTS must use loopback HTTP")
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout

    @classmethod
    def from_environment(cls) -> LocalTtsClient:
        """Build the client from the service environment with a safe default."""
        return cls(os.getenv("REMOTE_EMPLOYEE_TTS_URL", DEFAULT_ENDPOINT))

    def synthesize(self, voice: str, text: str) -> PcmAudio:
        """Request one WAV utterance and decode its validated PCM frames."""
        payload = json.dumps(
            {
                "script": text,
                "voice_id": local_voice(voice),
                "language": "english",
            }
        ).encode()
        request = urllib.request.Request(
            f"{self.endpoint}/tts/speak",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(  # noqa: S310
            request,
            timeout=self.timeout,
        ) as response:
            wav = response.read(MAXIMUM_AUDIO_BYTES + 1)
        if len(wav) > MAXIMUM_AUDIO_BYTES:
            raise RuntimeError("Kokoro audio exceeded the response limit")
        return decode_wav(wav)


def local_voice(voice: str) -> str:
    """Resolve persisted profile names and native Kokoro identifiers."""
    candidate = str(voice or "").strip()
    if candidate in LOCAL_VOICES:
        return candidate
    return PERSISTED_VOICES.get(candidate, "af_heart")


def decode_wav(value: bytes) -> PcmAudio:
    """Validate a mono 16-bit PCM WAV and return its raw frame bytes."""
    with wave.open(io.BytesIO(value), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise RuntimeError("Kokoro returned unsupported WAV channels")
        if source.getcomptype() != "NONE":
            raise RuntimeError("Kokoro returned compressed WAV audio")
        rate = source.getframerate()
        data = source.readframes(source.getnframes())
    if not data or rate <= 0:
        raise RuntimeError("Kokoro returned no PCM audio")
    return PcmAudio(data, rate)


async def synthesize(
    client: LocalTtsClient,
    voice: str,
    text: str,
) -> PcmAudio:
    """Run blocking loopback synthesis without blocking the LiveKit loop."""
    return await asyncio.to_thread(client.synthesize, voice, text)
