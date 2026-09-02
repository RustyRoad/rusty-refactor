import { Worker } from 'node:worker_threads';

/**
 * Starts the isolated Kokoro worker and waits until its model is loaded.
 */
export function createKokoroWorkerClient(configuration) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./kokoroWorker.mjs', import.meta.url),
            { workerData: configuration }
        );
        const startupFailure = error => {
            reject(error);
        };
        worker.once('error', startupFailure);
        worker.on('message', message => {
            if (!message || message.type !== 'ready') {
                return;
            }
            worker.off('error', startupFailure);
            resolve(new KokoroWorkerClient(worker, message));
        });
    });
}

/**
 * Serializes bounded jobs through one inference worker while the main HTTP
 * event loop remains responsive.
 */
class KokoroWorkerClient {
    /**
     * Connects worker events to a single-job queue and immutable metadata.
     */
    constructor(worker, readyMessage) {
        this.worker = worker;
        this.voices = readyMessage.voices;
        this.defaultVoice = readyMessage.defaultVoice;
        this.nextId = 1;
        this.queue = [];
        this.current = undefined;
        worker.on('message', message => {
            this.handleMessage(message);
        });
        worker.on('error', error => {
            this.handleFailure(error);
        });
    }

    /**
     * Queues one inference and rejects it promptly when its caller aborts.
     */
    synthesize(text, voice, signal) {
        if (signal.aborted) {
            return Promise.reject(abortError());
        }
        return new Promise((resolve, reject) => {
            const job = {
                id: this.nextId,
                text,
                voice,
                signal,
                resolve,
                reject,
                aborted: false
            };
            this.nextId += 1;
            job.abort = () => {
                this.abortJob(job);
            };
            signal.addEventListener('abort', job.abort, { once: true });
            this.queue.push(job);
            this.dispatch();
        });
    }

    /**
     * Reports queue state without waiting for the inference worker.
     */
    status() {
        return {
            busy: this.current !== undefined,
            queued: this.queue.filter(job => !job.aborted).length
        };
    }

    /**
     * Sends the next live job only after the previous worker call completes.
     */
    dispatch() {
        if (this.current) {
            return;
        }
        const job = this.nextLiveJob();
        if (!job) {
            return;
        }
        this.current = job;
        this.worker.postMessage({
            type: 'synthesize',
            id: job.id,
            text: job.text,
            voice: job.voice
        });
    }

    /**
     * Removes aborted queued work before selecting the next inference.
     */
    nextLiveJob() {
        while (this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job.aborted) {
                return job;
            }
            this.cleanJob(job);
        }
        return undefined;
    }

    /**
     * Applies a completion or failure message to the active worker job.
     */
    handleMessage(message) {
        const job = this.current;
        if (!job || !message || message.id !== job.id) {
            return;
        }
        if (!job.aborted) {
            if (message.type === 'complete') {
                job.resolve(Buffer.from(message.audio));
            } else if (message.type === 'failed') {
                job.reject(new Error(message.error));
            } else {
                return;
            }
        }
        this.cleanJob(job);
        this.current = undefined;
        this.dispatch();
    }

    /**
     * Marks one job canceled and releases it immediately when still queued.
     */
    abortJob(job) {
        if (job.aborted) {
            return;
        }
        job.aborted = true;
        job.reject(abortError());
        if (this.current !== job) {
            this.cleanJob(job);
        }
    }

    /**
     * Rejects all work before surfacing a fatal worker failure to systemd.
     */
    handleFailure(error) {
        if (this.current && !this.current.aborted) {
            this.current.reject(error);
            this.cleanJob(this.current);
        }
        this.current = undefined;
        for (const job of this.queue) {
            if (!job.aborted) {
                job.reject(error);
            }
            this.cleanJob(job);
        }
        this.queue = [];
        queueMicrotask(() => {
            throw error;
        });
    }

    /**
     * Removes the abort listener retained by one completed queue job.
     */
    cleanJob(job) {
        job.signal.removeEventListener('abort', job.abort);
    }
}

/**
 * Creates the standard cancellation error expected by fetch callers.
 */
function abortError() {
    const error = new Error('Speech synthesis was canceled.');
    error.name = 'AbortError';
    return error;
}
