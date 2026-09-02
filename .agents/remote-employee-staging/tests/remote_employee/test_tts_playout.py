import asyncio

from apps.remote_employee.tts_playout import speak_tts
from apps.remote_employee.tts_synthesis import PcmAudio


class Client:
    """Return one deterministic local Kokoro result."""

    def synthesize(self, _voice, _text):
        """Provide mono PCM without an HTTP dependency."""
        return PcmAudio(b"a" * 960, 24000)


class Source:
    """Record buffered LiveKit playout and cancellation."""

    def __init__(self):
        self.frames = []
        self.cleared = False

    async def capture_frame(self, frame):
        """Store one PCM frame."""
        self.frames.append(bytes(frame.data))

    async def wait_for_playout(self):
        """Complete immediately in the unit test."""
        return None

    def clear_queue(self):
        """Record discarded queued speech."""
        self.cleared = True


def test_uses_one_local_generation_before_livekit_playout():
    """Verify buffered compatibility playout accepts the local client."""
    source = Source()
    metrics = asyncio.run(speak_tts(Client(), "af_heart", "Hi", [source]))

    assert source.frames == [b"a" * 960]
    assert metrics.byte_count == 960
    assert metrics.interrupted is False


def test_interrupt_discards_buffered_playout():
    """Verify a preexisting interruption clears local speech."""
    source = Source()
    interrupted = asyncio.Event()
    interrupted.set()
    metrics = asyncio.run(
        speak_tts(Client(), "af_heart", "Stop", [source], interrupted)
    )

    assert source.frames == []
    assert source.cleared is True
    assert metrics.interrupted is True
