"""Queue complete PCM speech in LiveKit with interruptible playout."""

from __future__ import annotations

import asyncio

from livekit import rtc

from apps.remote_employee.tts_synthesis import PcmAudio


FRAME_MS = 200


async def _capture(
    sources: list[rtc.AudioSource], data: bytes, rate: int
) -> None:
    samples = len(data) // 2
    frame = rtc.AudioFrame(data, rate, 1, samples)
    await asyncio.gather(*(source.capture_frame(frame) for source in sources))


async def enqueue(
    audio: PcmAudio,
    sources: list[rtc.AudioSource],
    cancel_event: asyncio.Event | None,
) -> bool:
    """Queue bounded PCM frames while observing an interruption request."""
    width = audio.rate * 2 * FRAME_MS // 1000
    for offset in range(0, len(audio.data), width):
        if cancel_event and cancel_event.is_set():
            return True
        chunk = audio.data[offset : offset + width]
        await _capture(sources, chunk, audio.rate)
    return False


async def play(
    audio: PcmAudio,
    sources: list[rtc.AudioSource],
    cancel_event: asyncio.Event | None,
) -> bool:
    """Queue and play audio, discarding queued speech on interruption."""
    interrupted = await enqueue(audio, sources, cancel_event)
    return await finish(sources, cancel_event, interrupted)


async def finish(
    sources: list[rtc.AudioSource],
    cancel_event: asyncio.Event | None,
    interrupted: bool = False,
) -> bool:
    """Wait for queued audio or clear every queue when interrupted."""
    playout = asyncio.gather(*(source.wait_for_playout() for source in sources))
    if cancel_event and not interrupted:
        cancel = asyncio.create_task(cancel_event.wait())
        await asyncio.wait({playout, cancel}, return_when=asyncio.FIRST_COMPLETED)
        interrupted = cancel_event.is_set()
        cancel.cancel()
        await asyncio.gather(cancel, return_exceptions=True)
    if interrupted:
        for source in sources:
            source.clear_queue()
    await playout
    return interrupted
