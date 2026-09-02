import { parseJsonObject } from './requestBody.mjs';
import { createSpeechRequestLog } from './requestLog.mjs';

/**
 * Creates the service HTTP handler around one fully loaded synthesizer.
 */
export function createRequestHandler(
    configuration,
    synthesizer,
    logOutput = process.stdout
) {
    /**
     * Contains failures within one request so they cannot terminate the
     * long-running speech service.
     */
    async function handleRequest(request, response) {
        try {
            await routeRequest(
                request,
                response,
                configuration,
                synthesizer,
                logOutput
            );
        } catch (error) {
            respondError(response, error);
        }
    }

    return handleRequest;
}

/**
 * Routes one request to health, voice metadata, or speech synthesis.
 */
async function routeRequest(
    request,
    response,
    configuration,
    synthesizer,
    logOutput
) {
    const path = new URL(
        request.url ?? '/',
        'http://localhost'
    ).pathname;
    if (request.method === 'GET' && path === '/health') {
        const status = synthesizer.status();
        respondJson(response, 200, {
            status: 'ok',
            model: configuration.model,
            device: configuration.device,
            dtype: configuration.dtype,
            gpu_required: true,
            model_loaded: true,
            inference_busy: status.busy,
            queued_requests: status.queued
        });
        return;
    }
    if (request.method === 'GET' && path === '/voices') {
        respondJson(response, 200, {
            voices: synthesizer.voices,
            default_voice_id: synthesizer.defaultVoice
        });
        return;
    }
    if (request.method === 'POST' && path === '/tts/speak') {
        await synthesizeRequest(
            request,
            response,
            configuration,
            synthesizer,
            logOutput
        );
        return;
    }
    respondJson(response, 404, { error: 'Route not found.' });
}

/**
 * Validates a synthesis request and returns its generated WAV bytes.
 */
async function synthesizeRequest(
    request,
    response,
    configuration,
    synthesizer,
    logOutput
) {
    const log = createSpeechRequestLog(logOutput);
    let script = '';
    let voice = '';
    let controller;
    try {
        const body = await parseJsonObject(request);
        script = requiredScript(
            body.script,
            configuration.maximumScriptCharacters
        );
        voice = requestedVoice(
            body.voice_id,
            synthesizer.defaultVoice,
            synthesizer.voices
        );
        log.start(logDetails(script, voice));
        controller = requestController(request, response);
        const audio = await synthesizer.synthesize(
            script,
            voice,
            controller.signal
        );
        if (controller.signal.aborted || response.destroyed) {
            log.abort(logDetails(script, voice));
            return;
        }
        response.writeHead(200, {
            'cache-control': 'no-store',
            'content-length': audio.byteLength,
            'content-type': 'audio/wav'
        });
        response.end(audio);
        log.complete({
            ...logDetails(script, voice),
            audio_bytes: audio.byteLength
        });
    } catch (error) {
        if (controller?.signal.aborted || response.destroyed) {
            log.abort(logDetails(script, voice));
        } else {
            log.fail(error, logDetails(script, voice));
        }
        throw error;
    } finally {
        controller?.dispose();
    }
}

/**
 * Returns request metadata that is useful without logging private text.
 */
function logDetails(script, voice) {
    return {
        characters: script.length,
        voice: voice || undefined
    };
}

/**
 * Aborts queued synthesis when its HTTP client disconnects before response.
 */
function requestController(request, response) {
    const controller = new AbortController();
    const abort = () => {
        controller.abort();
    };
    const close = () => {
        if (!response.writableEnded) {
            controller.abort();
        }
    };

    /**
     * Removes connection listeners once the request has settled.
     */
    function dispose() {
        request.off('aborted', abort);
        response.off('close', close);
    }

    request.once('aborted', abort);
    response.once('close', close);
    return {
        signal: controller.signal,
        dispose
    };
}

/**
 * Returns a non-empty script within the configured inference limit.
 */
function requiredScript(value, maximumCharacters) {
    const script = typeof value === 'string' ? value.trim() : '';
    if (!script) {
        throw new Error('A non-empty script is required.');
    }
    if (script.length > maximumCharacters) {
        throw new Error(
            `The script exceeds ${maximumCharacters} characters.`
        );
    }
    return script;
}

/**
 * Resolves an optional voice identifier against the loaded model voices.
 */
function requestedVoice(value, defaultVoice, voices) {
    const voice = typeof value === 'string' && value.trim()
        ? value.trim()
        : defaultVoice;
    const exists = voices.some(candidate => {
        return candidate.voice_id === voice;
    });
    if (!exists) {
        throw new Error(`Unknown Kokoro voice: ${voice}`);
    }
    return voice;
}

/**
 * Writes one compact JSON response with explicit byte length.
 */
function respondJson(response, status, body) {
    const encoded = JSON.stringify(body);
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(encoded),
        'content-type': 'application/json'
    });
    response.end(encoded);
}

/**
 * Converts request or inference failures to a bounded JSON error response.
 */
function respondError(response, error) {
    if (response.destroyed || response.writableEnded) {
        return;
    }
    const detail = error instanceof Error
        ? error.message.slice(0, 500)
        : 'Unknown synthesis failure.';
    respondJson(response, 400, { error: detail });
}
