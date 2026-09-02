"""Retired CEO-audio-to-cloud-reasoning bridge.

CEO transcripts go to the CodeTether Agent Manager over A2A. Final responses
are rendered by the host-local Kokoro service.
"""


def main() -> None:
    """Refuse to start a bridge that would let Gemini answer independently."""
    raise SystemExit(
        "Gemini Live reasoning is disabled; use the CodeTether A2A manager"
    )


if __name__ == "__main__":
    main()
