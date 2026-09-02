"""Split completed narration into low-latency Kokoro requests."""

from __future__ import annotations


MAXIMUM_CHARACTERS = 180
MINIMUM_CHARACTERS = 48
PAUSES = ".!?;:"


def speech_chunks(text: str) -> list[str]:
    """Return bounded chunks, preferring natural sentence pauses."""
    remaining = " ".join(str(text or "").split())
    chunks: list[str] = []
    while len(remaining) > MAXIMUM_CHARACTERS:
        boundary = _boundary(remaining)
        chunks.append(remaining[:boundary].strip())
        remaining = remaining[boundary:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def _boundary(text: str) -> int:
    """Choose a sentence, whitespace, or hard boundary within the limit."""
    for index in range(MAXIMUM_CHARACTERS, MINIMUM_CHARACTERS, -1):
        if text[index] == " " and text[index - 1] in PAUSES:
            return index
    whitespace = text.rfind(" ", 0, MAXIMUM_CHARACTERS + 1)
    if whitespace >= MINIMUM_CHARACTERS:
        return whitespace
    return MAXIMUM_CHARACTERS
