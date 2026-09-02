"""Launch a validation server with the managed server's provider settings."""

import os
import subprocess


SOURCE_PID = os.environ["CODETETHER_SOURCE_PID"]
LOG_PATH = "/tmp/codetether-ws-validation.log"
REPOSITORY = "/home/riley/A2A-Server-MCP/codetether-agent"


def source_environment() -> dict[str, str]:
    """Copy provider settings without printing their secret values."""
    path = f"/proc/{SOURCE_PID}/environ"
    values = open(path, "rb").read().split(b"\0")
    pairs = (value.split(b"=", 1) for value in values if b"=" in value)
    return {
        key.decode(): value.decode()
        for key, value in pairs
    }


def launch() -> int:
    """Start an isolated authenticated server on the validation port."""
    environment = source_environment()
    environment["CODETETHER_AUTH_TOKEN"] = os.environ["WS_VALIDATION_TOKEN"]
    environment["CODETETHER_STATIC_TOKEN_ADMIN"] = "true"
    environment["OPA_ENABLED"] = "false"
    environment["OPA_FAIL_OPEN"] = "true"
    command = [
        "/home/riley/.cargo/bin/codetether",
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        os.environ["WS_VALIDATION_PORT"],
    ]
    with open(LOG_PATH, "ab", buffering=0) as output:
        process = subprocess.Popen(
            command,
            cwd=REPOSITORY,
            env=environment,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    return process.pid


print(launch())
