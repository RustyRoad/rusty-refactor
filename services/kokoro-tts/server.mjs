import { createServer } from 'node:http';

import { readConfiguration } from './configuration.mjs';
import {
    createKokoroWorkerClient
} from './kokoroWorkerClient.mjs';
import { createRequestHandler } from './requestHandler.mjs';

/**
 * Loads the model before accepting requests so health means inference is
 * ready rather than merely that a process is listening.
 */
async function startServer() {
    const configuration = readConfiguration();
    const synthesizer = await createKokoroWorkerClient(configuration);
    const handler = createRequestHandler(configuration, synthesizer);
    const server = createServer(handler);
    server.listen(configuration.port, '0.0.0.0', () => {
        process.stdout.write(
            `Kokoro TTS listening on port ${configuration.port}.\n`
        );
    });
}

await startServer();
