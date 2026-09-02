"""Buffered local synthesis followed by interruptible LiveKit playout."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from livekit import rtc

from apps.remote_employee.tts_pcm_playout import play
from apps.remote_employee.tts_synthesis import MODEL as MODEL
from apps.remote_employee.tts_synthesis import LocalTtsClient
from apps.remote_employee.tts_synthesis import synthesize


@dataclass(frozen=True)
class PlayoutMetrics:
    """Measurements for one buffered TTS playout."""

    byte_count: int
    first_audio_ms: int
    interrupted: bool = False


async def speak_tts(
    client: LocalTtsClient,
    voice: str,
    text: str,
    sources: list[rtc.AudioSource],
    cancel_event: asyncio.Event | None = None,
) -> PlayoutMetrics:
    """Synthesize completely, then let LiveKit schedule smooth PCM playout."""
    loop = asyncio.get_running_loop()
    started = loop.time()
    audio = await synthesize(client, voice, text)
    first_audio_ms = round((loop.time() - started) * 1000)
    interrupted = await play(audio, sources, cancel_event)
    return PlayoutMetrics(len(audio.data), first_audio_ms, interrupted)
