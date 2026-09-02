"""Stream local Kokoro utterances into LiveKit in bounded fragments."""

from __future__ import annotations

import asyncio

from dataclasses import dataclass

from livekit import rtc

from apps.remote_employee.tts_pcm_playout import enqueue, finish
from apps.remote_employee.tts_synthesis import (
    MODEL as MODEL,
    LocalTtsClient,
    synthesize,
)
from apps.remote_employee.tts_text_chunks import speech_chunks


@dataclass(frozen=True)
class StreamMetrics:
    """Measurements for one locally synthesized TTS playout."""

    byte_count: int
    first_audio_ms: int
    interrupted: bool = False


async def stream_tts(
    client: LocalTtsClient,
    voice: str,
    text: str,
    sources: list[rtc.AudioSource],
    cancel_event: asyncio.Event | None = None,
) -> StreamMetrics:
    """Synthesize and enqueue each fragment before requesting the next."""
    loop = asyncio.get_running_loop()
    started = loop.time()
    byte_count = 0
    first_audio_ms: int | None = None
    interrupted = False
    for chunk in speech_chunks(text):
        if cancel_event and cancel_event.is_set():
            interrupted = True
            break
        audio = await synthesize(client, voice, chunk)
        byte_count += len(audio.data)
        if first_audio_ms is None:
            first_audio_ms = round((loop.time() - started) * 1000)
        interrupted = await enqueue(audio, sources, cancel_event)
        if interrupted:
            break
    if not byte_count and not interrupted:
        raise RuntimeError("Kokoro TTS returned no audio")
    interrupted = await finish(sources, cancel_event, interrupted)
    return StreamMetrics(byte_count, first_audio_ms or 0, interrupted)
