from apps.remote_employee.tts_text_chunks import (
    MAXIMUM_CHARACTERS,
    speech_chunks,
)


def test_bounds_local_requests_at_natural_pauses():
    """Keep Kokoro latency and peak allocation bounded per fragment."""
    text = (
        "The first result is ready for review. "
        "The second result contains enough detail to make this narration "
        "longer than a single local inference request. "
        "The final result remains concise and useful."
    )
    chunks = speech_chunks(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= MAXIMUM_CHARACTERS for chunk in chunks)
    assert " ".join(chunks) == text
