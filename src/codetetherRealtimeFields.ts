/**
 * Reads one string field from an untrusted event payload.
 */
export function realtimeString(
    payload: Record<string, unknown>,
    key: string
): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

/**
 * Reads one boolean field from an untrusted event payload.
 */
export function realtimeBoolean(
    payload: Record<string, unknown>,
    key: string
): boolean {
    return payload[key] === true;
}
