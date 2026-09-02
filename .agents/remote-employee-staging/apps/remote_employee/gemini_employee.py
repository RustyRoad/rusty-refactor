"""Retired cloud Live employee entry point.

CodeTether is the only employee reasoning and tool-execution runtime. The
host-local Kokoro service renders final speech.
"""


def main() -> None:
    """Refuse to start the retired independent Gemini employee."""
    raise SystemExit(
        "Gemini Live employees are retired; run apps.remote_employee.tts_worker"
    )


if __name__ == "__main__":
    main()
