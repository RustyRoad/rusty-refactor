import asyncio
import threading

from apps.remote_employee import tts_stream
from apps.remote_employee.tts_stream import stream_tts
from apps.remote_employee.tts_synthesis import PcmAudio


class Client:
    """Return deterministic local PCM for successive Kokoro fragments."""

    def __init__(self, outputs, first_captured=None):
        self.outputs = iter(outputs)
        self.calls = []
        self.first_captured = first_captured

    def synthesize(self, voice, text):
        """Record the local request and return its prepared PCM."""
        if self.calls and self.first_captured:
            assert self.first_captured.wait(1)
        self.calls.append((voice, text))
        return next(self.outputs)


class Source:
    """Capture LiveKit PCM frames without requiring a room."""

    def __init__(self, captured=None):
        self.frames = []
        self.captured = captured
        self.cleared = False

    async def capture_frame(self, frame):
        """Store one emitted frame and expose first-frame timing."""
        self.frames.append(bytes(frame.data))
        if self.captured:
            self.captured.set()

    async def wait_for_playout(self):
        """Complete immediately because no real LiveKit queue exists."""
        return None

    def clear_queue(self):
        """Record interruption cleanup."""
        self.cleared = True


def test_plays_first_local_chunk_before_requesting_the_second(monkeypatch):
    """Prove bounded Kokoro calls overlap synthesis with LiveKit delivery."""
    captured = threading.Event()
    source = Source(captured)
    client = Client(
        [PcmAudio(b"a" * 9600, 24000), PcmAudio(b"b" * 9600, 24000)],
        captured,
    )
    monkeypatch.setattr(
        tts_stream,
        "speech_chunks",
        lambda _text: ["one", "two"],
    )

    metrics = asyncio.run(stream_tts(client, "Charon", "Narration", [source]))

    assert client.calls == [("Charon", "one"), ("Charon", "two")]
    assert source.frames == [b"a" * 9600, b"b" * 9600]
    assert metrics.byte_count == 19200
    assert metrics.first_audio_ms < 1000


def test_interrupt_stops_after_the_current_audio_frame(monkeypatch):
    """Ensure a participant interruption clears remaining local speech."""
    interrupted = asyncio.Event()

    class InterruptingSource(Source):
        """Signal interruption after accepting one frame."""

        async def capture_frame(self, frame):
            """Capture one frame and interrupt before the next."""
            await super().capture_frame(frame)
            interrupted.set()

    monkeypatch.setattr(tts_stream, "speech_chunks", lambda _text: ["one"])
    client = Client([PcmAudio(b"a" * 19200, 24000)])
    source = InterruptingSource()
    metrics = asyncio.run(
        stream_tts(client, "af_heart", "Long response", [source], interrupted)
    )

    assert len(source.frames) == 1
    assert source.cleared is True
    assert metrics.interrupted is True
