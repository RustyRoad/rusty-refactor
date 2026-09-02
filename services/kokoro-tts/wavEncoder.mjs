const channelCount = 1;
const bitsPerSample = 16;
const headerBytes = 44;

const minimumAudiblePeak = 0.00001;

/**
 * Validates model samples and returns their count and absolute peak.
 */
function inspectSamples(chunks) {
    let count = 0;
    let peak = 0;
    for (const chunk of chunks) {
        for (const sample of chunk) {
            if (!Number.isFinite(sample)) {
                throw new Error('The model returned invalid audio samples.');
            }
            count += 1;
            peak = Math.max(peak, Math.abs(sample));
        }
    }
    if (count === 0) {
        throw new Error('The model returned no audio samples.');
    }
    if (peak < minimumAudiblePeak) {
        throw new Error('The model returned silent audio.');
    }
    return { count, peak };
}

/**
 * Clamps one normalized floating-point sample to signed 16-bit PCM.
 */
function encodeSample(sample) {
    const bounded = Math.max(-1, Math.min(1, sample));
    return bounded < 0
        ? Math.round(bounded * 0x8000)
        : Math.round(bounded * 0x7fff);
}

/**
 * Encodes mono floating-point chunks as a RIFF/WAVE PCM buffer without
 * retaining a second full-size floating-point copy.
 */
export function encodeWav(chunks, sampleRate) {
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
        throw new Error('The audio sample rate must be a positive integer.');
    }

    const sampleCount = inspectSamples(chunks).count;
    const dataBytes = sampleCount * bitsPerSample / 8;
    const output = Buffer.allocUnsafe(headerBytes + dataBytes);
    writeHeader(output, sampleRate, dataBytes);
    writeSamples(output, chunks);
    return output;
}

/**
 * Writes the fixed mono PCM RIFF/WAVE header for one encoded audio buffer.
 */
function writeHeader(output, sampleRate, dataBytes) {
    const blockAlign = channelCount * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    output.write('RIFF', 0, 'ascii');
    output.writeUInt32LE(36 + dataBytes, 4);
    output.write('WAVE', 8, 'ascii');
    output.write('fmt ', 12, 'ascii');
    output.writeUInt32LE(16, 16);
    output.writeUInt16LE(1, 20);
    output.writeUInt16LE(channelCount, 22);
    output.writeUInt32LE(sampleRate, 24);
    output.writeUInt32LE(byteRate, 28);
    output.writeUInt16LE(blockAlign, 32);
    output.writeUInt16LE(bitsPerSample, 34);
    output.write('data', 36, 'ascii');
    output.writeUInt32LE(dataBytes, 40);
}

/**
 * Writes normalized samples sequentially after the WAV header.
 */
function writeSamples(output, chunks) {
    let offset = headerBytes;
    for (const chunk of chunks) {
        for (const sample of chunk) {
            output.writeInt16LE(encodeSample(sample), offset);
            offset += bitsPerSample / 8;
        }
    }
}
