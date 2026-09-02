import { randomUUID } from 'node:crypto';

/**
 * Creates one privacy-safe lifecycle logger for a speech request.
 */
export function createSpeechRequestLog(output = process.stdout) {
    const requestId = randomUUID();
    const started = performance.now();

    /**
     * Writes one bounded JSON record without including synthesized text.
     */
    function write(status, details) {
        output.write(`${JSON.stringify({
            event: 'tts_request',
            request_id: requestId,
            status,
            elapsed_ms: Math.round(performance.now() - started),
            ...details
        })}\n`);
    }

    return {
        /** Records validated work before it enters the inference queue. */
        start(details) {
            write('started', details);
        },
        /** Records successful WAV generation and response size. */
        complete(details) {
            write('completed', details);
        },
        /** Records a disconnected caller without treating it as inference. */
        abort(details) {
            write('aborted', details);
        },
        /** Records a bounded error description for failed inference. */
        fail(error, details) {
            const message = error instanceof Error
                ? error.message.slice(0, 300)
                : 'Unknown synthesis failure.';
            write('failed', { ...details, error: message });
        }
    };
}
