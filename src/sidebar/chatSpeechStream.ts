/**
 * Plays one prepared speech fragment without overlapping later fragments.
 */
export type ChatSpeechFragmentPlayer = (
    text: string
) => Promise<void>;

/**
 * Finalizes playback after every accepted fragment has been dispatched.
 */
export type ChatSpeechStreamFinisher = () => Promise<void> | void;

/**
 * Reports an asynchronous synthesis or playback failure.
 */
export type ChatSpeechStreamFailure = (error: unknown) => void;

/**
 * Serializes fragments belonging to one progressively streamed response.
 */
export class ChatSpeechStream {
    private cancelled = false;
    private tail: Promise<void> = Promise.resolve();

    /**
     * Binds ordered playback to the owning speech service generation.
     */
    public constructor(
        private readonly play: ChatSpeechFragmentPlayer,
        private readonly finishPlayback: ChatSpeechStreamFinisher,
        private readonly fail: ChatSpeechStreamFailure
    ) {}

    /**
     * Queues one non-empty prepared fragment behind earlier synthesis.
     */
    public append(text: string): void {
        if (!text || this.cancelled) {
            return;
        }
        this.enqueue(() => this.play(text));
    }

    /**
     * Closes input after all previously queued fragments are dispatched.
     */
    public finish(): void {
        if (this.cancelled) {
            return;
        }
        this.enqueue(async () => {
            await this.finishPlayback();
        });
    }

    /**
     * Prevents queued work from reaching a superseded speech backend.
     */
    public cancel(): void {
        this.cancelled = true;
    }

    /**
     * Adds one guarded operation while containing its asynchronous failure.
     */
    private enqueue(operation: () => Promise<void>): void {
        this.tail = this.tail.then(async () => {
            if (!this.cancelled) {
                await operation();
            }
        }).catch(error => {
            if (!this.cancelled) {
                this.cancelled = true;
                this.fail(error);
            }
        });
    }
}
