"""Exercise authenticated prompt streaming and in-turn steering."""

import asyncio
import json
import os
import urllib.error
import urllib.request

import websockets


PORT = os.environ["WS_VALIDATION_PORT"]
TOKEN = os.environ["WS_VALIDATION_TOKEN"]
HTTP_BASE = f"http://127.0.0.1:{PORT}"
WS_BASE = f"ws://127.0.0.1:{PORT}"


def request(path: str, data: bytes | None = None) -> dict:
    """Send one authenticated JSON request to the validation server."""
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }
    method = "POST" if data is not None else "GET"
    value = urllib.request.Request(
        HTTP_BASE + path, data=data, headers=headers, method=method,
    )
    with urllib.request.urlopen(value, timeout=20) as response:
        return json.load(response)


def assert_authentication() -> None:
    """Prove the realtime route rejects an unauthenticated request."""
    try:
        urllib.request.urlopen(
            HTTP_BASE + "/api/realtime/session/missing", timeout=20,
        )
    except urllib.error.HTTPError as error:
        assert error.code == 401, error.code
        return
    raise AssertionError("Unauthenticated realtime request was accepted")


async def validate(session_id: str) -> None:
    """Stream one tool-using turn and steer it before completion."""
    uri = f"{WS_BASE}/api/realtime/session/{session_id}"
    headers = {"Authorization": f"Bearer {TOKEN}"}
    kinds: list[str] = []
    steering_sent = False
    steering_accepted = False
    async with websockets.connect(uri, additional_headers=headers) as socket:
        prompt = (
            "Run `printf websocket-validation` with a shell tool. "
            "Then wait for my steering message before answering."
        )
        await socket.send(json.dumps({"type": "prompt", "message": prompt}))
        while True:
            frame = json.loads(await asyncio.wait_for(socket.recv(), 240))
            if frame["type"] == "event":
                kind = frame["event"]["kind"]
                kinds.append(kind)
                if kind.startswith("tool.") and not steering_sent:
                    await socket.send(json.dumps({
                        "type": "steer",
                        "request_id": "live-steer-1",
                        "message": "Answer with the marker STEERING_APPLIED.",
                    }))
                    steering_sent = True
            elif frame["type"] == "steering":
                steering_accepted = frame["accepted"]
            elif frame["type"] == "error":
                raise AssertionError(frame["message"])
            elif frame["type"] == "result":
                result = json.dumps(frame["result"])
                break
    assert any(kind.startswith("tool.") for kind in kinds), kinds
    assert "item.delta" in kinds, kinds
    assert steering_sent and steering_accepted
    assert "STEERING_APPLIED" in result, result
    print(json.dumps({
        "authentication": "rejected_without_bearer",
        "event_kinds": kinds,
        "steering": "accepted_and_applied",
    }))


async def main() -> None:
    """Create a session and run the complete live validation."""
    assert_authentication()
    session = request("/api/session", b"{}")
    await validate(session["id"])


asyncio.run(main())
