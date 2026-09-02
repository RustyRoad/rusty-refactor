"""Run the unified employee presence reconciliation loop."""

import asyncio
import signal

from apps.remote_employee.presence_liaison import ensure_liaison, stop_liaison
from apps.remote_employee.presence_roster import company
from apps.remote_employee.presence_selection import voice_employee_ids
from apps.remote_employee.presence_voice import (
    VoiceTask,
    reconcile_voice_tasks,
    stop_voice_tasks,
)


async def run(api_base: str, interval: float) -> None:
    """Keep one Rust liaison and all voice workers alive on one Python loop."""
    tasks: dict[str, VoiceTask] = {}
    liaison: asyncio.subprocess.Process | None = None
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for event in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(event, stopping.set)
    try:
        while not stopping.is_set():
            liaison = await ensure_liaison(liaison)
            try:
                snapshot = await asyncio.to_thread(company, api_base)
            except Exception as error:  # noqa: BLE001
                print(f"roster unavailable: {error}", flush=True)
            else:
                selected = voice_employee_ids(snapshot)
                roster = [
                    employee
                    for employee in snapshot["employees"]
                    if employee["id"] in selected
                ]
                await reconcile_voice_tasks(tasks, roster, api_base)
            try:
                await asyncio.wait_for(stopping.wait(), timeout=interval)
            except TimeoutError:
                pass
    finally:
        await stop_voice_tasks(tasks)
        await stop_liaison(liaison)
