import * as fs from 'fs';
import * as path from 'path';

/**
 * Locates the packaged Rust helper used by chat speech features.
 */
export class ChatWorkerLocator {
    public constructor(private readonly extensionPath: string) {}

    /**
     * Returns the packaged Rust worker executable path when it exists.
     */
    public workerPath(): string | undefined {
        for (const candidate of this.workerCandidates()) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return undefined;
    }

    /**
     * Returns possible worker locations for packaged and local builds.
     */
    private workerCandidates(): string[] {
        const releaseDir = path.join(
            this.extensionPath,
            'rust-backend',
            'target',
            'release'
        );

        return [
            path.join(releaseDir, 'rusty_refactor_worker.exe'),
            path.join(releaseDir, 'rusty_refactor_worker'),
            path.join(releaseDir, 'rusty_refactor_worker_bin.exe'),
            path.join(releaseDir, 'rusty_refactor_worker_bin')
        ];
    }
}
