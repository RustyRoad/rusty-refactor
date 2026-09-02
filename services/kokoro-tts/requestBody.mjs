const maximumBodyBytes = 64 * 1024;

/**
 * Reads a bounded request body so an untrusted caller cannot grow memory
 * without limit before JSON parsing.
 */
async function readBoundedBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maximumBodyBytes) {
            throw new Error('The request body is too large.');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Parses one JSON object from an incoming request and rejects other shapes.
 */
export async function parseJsonObject(request) {
    const body = await readBoundedBody(request);
    let value;
    try {
        value = JSON.parse(body);
    } catch {
        throw new Error('The request body must contain valid JSON.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The request body must be a JSON object.');
    }
    return value;
}
