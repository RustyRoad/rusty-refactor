"""Speak completed CodeTether responses through local TTS and LiveKit."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import urllib.request
import uuid

from collections.abc import Callable
from typing import Any, TypeVar
from urllib.error import HTTPError, URLError

from livekit import rtc

from apps.remote_employee.codetether_json import conversational_response
from apps.remote_employee.employee_presence import room_credentials
from apps.remote_employee.tts_greeting import office_acknowledgement
from apps.remote_employee.tts_narration import (
    narrations,
    needs_final_playout,
    pending_narrations,
    playout_text,
)
from apps.remote_employee.tts_rooms import connect_rooms, disconnect_rooms
from apps.remote_employee.tts_control_plane import refresh as refresh_state
from apps.remote_employee.tts_stream import MODEL, stream_tts
from apps.remote_employee.tts_synthesis import LocalTtsClient
from apps.remote_employee.voice_worker_config import VoiceWorkerConfig


T = TypeVar("T")


async def api_call(
    function: Callable[..., T], *args: object, retry_seconds: float = 2
) -> T:
    """Keep transient control-plane outages from killing LiveKit playout."""
    while True:
        try:
            return await asyncio.to_thread(function, *args)
        except HTTPError as error:
            if error.code < 500:
                raise
            print(f"control_plane_retry status={error.code}", flush=True)
        except (OSError, TimeoutError, URLError) as error:
            print(f"control_plane_retry error={type(error).__name__}", flush=True)
        await asyncio.sleep(retry_seconds)


def company(api_base: str) -> dict[str, Any]:
    """Fetch authoritative task/output state from the local control plane."""
    request = urllib.request.Request(f"{api_base.rstrip('/')}/api/company")
    if token := os.getenv("REMOTE_EMPLOYEE_ADMIN_TOKEN", "").strip():
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        return json.load(response)


def _post(api_base: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Post one authenticated JSON request to the local control plane."""
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if token := os.getenv("REMOTE_EMPLOYEE_ADMIN_TOKEN", "").strip():
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        return json.load(response)


def claim_speech(
    api_base: str, employee_id: str, worker_id: str
) -> dict[str, Any] | None:
    """Atomically acquire one response belonging to this employee."""
    result = _post(
        api_base,
        f"/api/employees/{employee_id}/speech/claim",
        {"worker_id": worker_id},
    )
    return result.get("task")


def mark_spoken(api_base: str, task_id: str, worker_id: str) -> None:
    """Persist successful playout so restarts cannot repeat a response."""
    _post(
        api_base,
        f"/api/tasks/{task_id}/spoken",
        {"worker_id": worker_id},
    )


def release_speech(api_base: str, task_id: str, worker_id: str) -> None:
    """Return a failed speech attempt to the delivery queue."""
    _post(
        api_base,
        f"/api/tasks/{task_id}/speech/release",
        {"worker_id": worker_id},
    )


def request_office_briefing(api_base: str, employee_id: str) -> bool:
    """Ask the manager for a fresh live briefing instead of replaying a greeting."""
    try:
        _post(
            api_base,
            f"/api/employees/{employee_id}/tasks",
            {
                "source": "office.entry",
                "objective": (
                    "Give Riley a concise executive briefing now. Use the fresh office "
                    "and CodeTether OKR snapshots attached to this turn. Lead with what "
                    "is important, who is working on it, what changed, and what is "
                    "blocked. Tie work to the original objective and key result when "
                    "recent observed evidence supports it. Treat the OKR ledger as possibly "
                    "stale planning intent, not proof of progress; call out unverified, "
                    "unaligned, or draft-only work. Say someone is working only when their "
                    "live status is working; review is finished awaiting Riley, and "
                    "idle/reachable is merely available. Own changing unmapped mux work: "
                    "identify it from the supplied output evidence and take the next read-only "
                    "follow-up yourself. State what you are doing next; do not ask whether you "
                    "should investigate. Ask Riley only for a real business choice or permission. Do "
                    "not reintroduce yourself, give a generic welcome, or read route IDs "
                    "and telemetry aloud. Keep the spoken briefing under 90 words."
                ),
            },
        )
        return True
    except HTTPError as error:
        if error.code == 409:
            return False
        raise


def private_credentials(api_base: str, employee_id: str, name: str) -> dict:
    """Issue an employee-identity token for the employee's private room."""
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}/api/employees/{employee_id}/meeting-token",
        data=json.dumps({"identity": f"employee:{employee_id}", "name": name}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if token := os.getenv("REMOTE_EMPLOYEE_ADMIN_TOKEN", "").strip():
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        return json.load(response)


async def run(args: VoiceWorkerConfig) -> None:
    """Lease employee responses and speak them while the CEO is present."""
    client = LocalTtsClient.from_environment()
    state = await api_call(company, args.api_base, retry_seconds=args.poll_seconds)
    worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    credential_requests = [
        api_call(private_credentials, args.api_base, args.employee_id, args.name)
    ]
    if args.office_audio:
        credential_requests.insert(
            0,
            api_call(
                room_credentials,
                args.api_base,
                f"employee:{args.employee_id}",
                args.name,
            ),
        )
    credentials = await asyncio.gather(*credential_requests)
    ceo_present = asyncio.Event()
    entry_requested = asyncio.Event()
    speech_interrupted = asyncio.Event()
    ceo_participants: set[tuple[int, str]] = set()
    seen_narration = {item.event_id for item in narrations(state, args.employee_id)}
    narrated_tasks: set[str] = set()
    briefing_pending = False
    next_briefing_at = 0.0
    last_entry_greeting = float("-inf")

    def room_has_ceo(room: rtc.Room) -> bool:
        return any(room_id == id(room) for room_id, _ in ceo_participants)

    def update_ceo_presence() -> None:
        if ceo_participants:
            ceo_present.set()
        else:
            ceo_present.clear()

    def watch_room(room: rtc.Room, shared_office: bool) -> None:
        @room.on("participant_connected")
        def participant_connected(participant: rtc.RemoteParticipant) -> None:
            if not participant.identity.startswith("employee:"):
                ceo_participants.add((id(room), participant.identity))
                update_ceo_presence()
                if shared_office:
                    entry_requested.set()

        @room.on("participant_disconnected")
        def participant_disconnected(participant: rtc.RemoteParticipant) -> None:
            if not participant.identity.startswith("employee:"):
                ceo_participants.discard((id(room), participant.identity))
                update_ceo_presence()

        @room.on("data_received")
        def data_received(packet: rtc.DataPacket) -> None:
            if packet.topic != "office.control":
                return
            if packet.participant and packet.participant.identity.startswith(
                "employee:"
            ):
                return
            try:
                payload = json.loads(packet.data.decode())
            except (UnicodeDecodeError, json.JSONDecodeError):
                return
            if (
                payload.get("type") == "employee.interrupt"
                and payload.get("employee_id") == args.employee_id
            ):
                speech_interrupted.set()
            elif shared_office and payload.get("type") == "office.enter":
                entry_requested.set()

    rooms, sources, track_ids = await connect_rooms(
        credentials, args.office_audio, watch_room
    )
    for room in rooms:
        present_ceos = [
            participant
            for participant in room.remote_participants.values()
            if not participant.identity.startswith("employee:")
        ]
        ceo_participants.update(
            (id(room), participant.identity) for participant in present_ceos
        )
    update_ceo_presence()
    print(
        f"employee={args.employee_id} model={MODEL} voice={args.voice} "
        f"rooms={len(rooms)} audio_tracks={','.join(track_ids)}",
        flush=True,
    )
    try:
        while True:
            if not ceo_present.is_set():
                state = await refresh_state(company, state, args.api_base)
                seen_narration.update(
                    item.event_id for item in narrations(state, args.employee_id)
                )
                await asyncio.sleep(args.poll_seconds)
                continue
            present_sources = [
                source
                for room, source in zip(rooms, sources, strict=True)
                if room_has_ceo(room)
            ]
            active_sources = present_sources[-1:]
            now = asyncio.get_running_loop().time()
            if entry_requested.is_set() and args.office_audio:
                entry_requested.clear()
                briefing_pending = True
                if active_sources and now - last_entry_greeting >= 60:
                    speech_interrupted.clear()
                    greeting = office_acknowledgement(state, args.employee_id)
                    metrics = await stream_tts(
                        client,
                        args.voice,
                        greeting,
                        active_sources,
                        speech_interrupted,
                    )
                    last_entry_greeting = now
                    print(
                        f"office greeting=true tts_bytes={metrics.byte_count} "
                        f"first_audio_ms={metrics.first_audio_ms}",
                        flush=True,
                    )
            state = await refresh_state(company, state, args.api_base)
            if briefing_pending and args.office_audio and now >= next_briefing_at:
                queued = await api_call(
                    request_office_briefing,
                    args.api_base,
                    args.employee_id,
                    retry_seconds=args.poll_seconds,
                )
                briefing_pending = not queued
                next_briefing_at = now + 5
                print(f"office live_briefing_queued={str(queued).lower()}", flush=True)
            pending = pending_narrations(state, args.employee_id, seen_narration)
            seen_narration.update(
                item.event_id for item in narrations(state, args.employee_id)
            )
            for narration in pending:
                if not active_sources:
                    break
                speech_interrupted.clear()
                spoken_text = playout_text(narration.text)
                metrics = await stream_tts(
                    client,
                    args.voice,
                    spoken_text,
                    active_sources,
                    speech_interrupted,
                )
                seen_narration.add(narration.event_id)
                narrated_tasks.add(narration.task_id)
                print(
                    f"task={narration.task_id} narration={narration.event_id} "
                    f"codetether_chars={len(spoken_text)} "
                    f"tts_bytes={metrics.byte_count} "
                    f"first_audio_ms={metrics.first_audio_ms} "
                    f"interrupted={str(metrics.interrupted).lower()} spoken=true",
                    flush=True,
                )
            task = await api_call(
                claim_speech,
                args.api_base,
                args.employee_id,
                worker_id,
                retry_seconds=args.poll_seconds,
            )
            if task:
                response = playout_text(
                    conversational_response(str(task["response_text"]))
                )
                task_id = task["id"]
                if not needs_final_playout(task_id, narrated_tasks):
                    await api_call(
                        mark_spoken,
                        args.api_base,
                        task_id,
                        worker_id,
                        retry_seconds=args.poll_seconds,
                    )
                    continue
                speech_interrupted.clear()
                try:
                    if not active_sources:
                        await api_call(
                            release_speech,
                            args.api_base,
                            task_id,
                            worker_id,
                            retry_seconds=args.poll_seconds,
                        )
                        continue
                    metrics = await stream_tts(
                        client,
                        args.voice,
                        response,
                        active_sources,
                        speech_interrupted,
                    )
                    await api_call(
                        mark_spoken,
                        args.api_base,
                        task_id,
                        worker_id,
                        retry_seconds=args.poll_seconds,
                    )
                except BaseException:
                    await api_call(
                        release_speech,
                        args.api_base,
                        task_id,
                        worker_id,
                        retry_seconds=args.poll_seconds,
                    )
                    raise
                print(
                    f"task={task_id} codetether_chars={len(response)} "
                    f"tts_bytes={metrics.byte_count} "
                    f"first_audio_ms={metrics.first_audio_ms} "
                    f"interrupted={str(metrics.interrupted).lower()} spoken=true",
                    flush=True,
                )
            await asyncio.sleep(args.poll_seconds)
    finally:
        await disconnect_rooms(rooms)


def main() -> None:
    """Parse worker identity and start its response watcher."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--employee-id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument(
        "--greeting",
        default="Welcome to the office. I am here and ready to help.",
        help="Deprecated compatibility option; live briefings are generated instead",
    )
    parser.add_argument("--api-base", default="http://127.0.0.1:8090")
    parser.add_argument("--poll-seconds", type=float, default=2)
    parser.add_argument(
        "--office-audio",
        action="store_true",
        help="Publish this employee's voice to the shared office room",
    )
    args = parser.parse_args()
    asyncio.run(
        run(
            VoiceWorkerConfig(
                employee_id=args.employee_id,
                name=args.name,
                voice=args.voice,
                greeting=args.greeting,
                api_base=args.api_base,
                poll_seconds=args.poll_seconds,
                office_audio=args.office_audio,
            )
        )
    )


if __name__ == "__main__":
    main()
