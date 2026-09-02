# Remote Employee

Remote Employee is an A2A-native company office. CodeTether peers are discovered
from mDNS agent cards, one peer acts as the CEO's Agent Manager, and LiveKit gives
the manager and employees visible and audible presence.

## Start

From the repository root:

```bash
python3 apps/remote_employee/run.py
```

In another service/process, run the presence reconciler:

```bash
remote-employee-presence
```

The reconciler supervises a deterministic `remote-employee-manager` CodeTether
A2A peer plus one local-Kokoro/LiveKit worker per registered employee. The
control plane appoints that deterministic peer as manager when mDNS sees it.

## Runtime flow

```text
                         mDNS + public A2A cards
CodeTether peers  <-------------------------------->  Remote Employee API
      ^                 authenticated JSON-RPC                |
      |                                                       | task state
      +---- Agent Manager delegates specialist work           v
CEO browser ---- transcript ------------------------------> SQLite
     |                                                       |
     +---------------- LiveKit media <---- local Kokoro <-----+
```

Speech stays on the host through the loopback-only CUDA Kokoro service. The
retired Gemini Live modules refuse to start.

The browser automatically listens to the shared office without selecting an
avatar. Browser autoplay policy may require one click anywhere to unlock sound.
Only the Agent Manager speaks in the shared room; select `Join conversation` to
enable the CEO microphone/camera, or choose an employee for a private meeting.
The office dock includes microphone-input and speaker-output selectors.

## Security boundaries

- A2A collaboration tokens remain in the in-memory mDNS directory.
- LiveKit API credentials remain server-side; browsers receive scoped room JWTs.
- Remote API access requires a CEO bearer token. Trusted-LAN mode uses the direct
  socket address and does not trust spoofable forwarding headers.
- Workspaces and raw mux output are still local-MVP surfaces; production needs an
  allowlist, tenant isolation, redaction, budgets, and a durable audit log.
