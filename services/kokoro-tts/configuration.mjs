const defaultPort = 8016;
const defaultModel = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const defaultVoice = 'af_heart';
const defaultDtype = 'fp32';
const defaultDevice = 'cuda';
const defaultMaximumScriptCharacters = 400;

/**
 * Reads one positive integer while keeping malformed values out of runtime
 * limits and network configuration.
 */
function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : fallback;
}

/**
 * Reads the service configuration once so request handling has no hidden
 * dependency on mutable process environment state.
 */
export function readConfiguration(environment = process.env) {
    return {
        port: positiveInteger(environment.PORT, defaultPort),
        model: environment.KOKORO_MODEL?.trim() || defaultModel,
        voice: environment.KOKORO_VOICE?.trim() || defaultVoice,
        dtype: environment.KOKORO_DTYPE?.trim() || defaultDtype,
        device: requiredCudaDevice(environment.KOKORO_DEVICE),
        cacheDirectory: environment.KOKORO_CACHE?.trim() || undefined,
        maximumScriptCharacters: positiveInteger(
            environment.MAXIMUM_SCRIPT_CHARACTERS,
            defaultMaximumScriptCharacters
        )
    };
}

/**
 * Rejects startup configurations that could silently run inference on CPU.
 */
function requiredCudaDevice(value) {
    const device = value?.trim().toLowerCase() || defaultDevice;
    if (device !== defaultDevice) {
        throw new Error('KOKORO_DEVICE must be cuda.');
    }
    return device;
}
