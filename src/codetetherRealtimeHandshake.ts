/**
 * Explains a rejected realtime WebSocket handshake in actionable terms.
 *
 * `ws` reports a non-101 upgrade only as "Unexpected server response: N".
 * The CodeTether server returns 403 for any route its policy table does not
 * know, so an old binary that predates `/api/realtime/session/{id}` looks
 * identical to a real permission failure. This module turns the status into
 * a message that names the likely cause and the fix.
 */

/**
 * Oldest CodeTether build that serves the realtime session route.
 */
const REALTIME_MINIMUM_VERSION = '4.7.5-dev.42';

/**
 * Builds the error raised when the realtime upgrade is refused.
 *
 * @param statusCode - HTTP status returned instead of `101`.
 * @param hostname - Loopback host of the managed server.
 * @param port - Port of the managed server that refused the upgrade.
 * @returns Error whose message includes the status and a remediation hint.
 */
export function realtimeHandshakeError(
    statusCode: number | undefined,
    hostname: string,
    port: number
): Error {
    const status = statusCode ?? 0;
    const target = `${hostname}:${port}`;
    return new Error(
        `CodeTether realtime handshake to ${target} returned HTTP ${status}`
        + ` instead of a WebSocket upgrade. ${handshakeHint(status)}`
    );
}

/**
 * Chooses the remediation hint for one refused handshake status.
 *
 * 403 and 404 both mean the server did not recognize the realtime route,
 * which in practice is an outdated `codetether` binary. 401 means the
 * bearer token did not match the managed server's token.
 *
 * @param status - HTTP status from the failed upgrade.
 * @returns Human-readable hint, empty when the status is not recognized.
 */
function handshakeHint(status: number): string {
    if (status === 403 || status === 404) {
        return 'The running `codetether` binary does not expose '
            + '/api/realtime/session; upgrade codetether to '
            + `${REALTIME_MINIMUM_VERSION} or newer, or set `
            + '`rustyRefactor.codetetherChatTransport` to "run".';
    }
    if (status === 401) {
        return 'The managed server rejected the bearer token; '
            + 'reload the window to restart the server.';
    }
    return '';
}
