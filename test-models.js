#!/usr/bin/env node

/**
 * Test: parse codetether models output
 */

const { spawn } = require('child_process');

function listModelsViaCli() {
    return new Promise((resolve) => {
        const proc = spawn('codetether', ['models'], {
            shell: false,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('error', (err) => {
            console.error(`[Error] Failed to spawn codetether: ${err.message}`);
            resolve([]);
        });

        proc.on('close', () => {
            const combined = `${stdout}\n${stderr}`;
            console.log(`[Debug] Total output length: ${combined.length} chars\n`);

            const models = [];
            let currentProvider = '';
            let providerCount = 0;
            let modelCount = 0;
            let filteredCount = 0;
            let processedLines = 0;

            const lines = combined.split(/\r?\n/);
            console.log(`[Debug] Total lines to process: ${lines.length}\n`);

            for (let i = 0; i < lines.length; i++) {
                const rawLine = lines[i];
                // Strip ANSI color codes
                const stripped = rawLine.replace(/\u001b\[[0-9;]*m/g, '');
                const line = stripped.replace(/\r/g, '');
                const trimmed = line.trim();

                processedLines++;
                if (processedLines % 50 === 0) {
                    console.log(`[Progress] Processed ${processedLines}/${lines.length}`);
                }

                if (!trimmed) continue;

                // Skip log lines
                if (/\b(INFO|WARN|ERROR|DEBUG)\b/.test(trimmed) || /^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
                    filteredCount++;
                    continue;
                }

                // Check for indented model names
                if (/^\s{2,}\S+/.test(line)) {
                    if (currentProvider) {
                        const modelId = trimmed.split(/\s+/)[0];
                        if (modelId) {
                            models.push(`${currentProvider}/${modelId}`);
                            modelCount++;
                        }
                    }
                    continue;
                }

                // Check for provider name
                const isProvider = /^[a-z0-9][\w-]*$/i.test(trimmed);
                if (i < 10 || (providerCount === 0 && i < 20)) {
                    const charCodes = Array.from(trimmed).map(c => c.charCodeAt(0)).join(',');
                    console.log(`[Line ${i}] "${trimmed.substring(0, 20)}" => provider=${isProvider}, length=${trimmed.length}, codes=[${charCodes.substring(0, 100)}]`);
                }
                if (isProvider) {
                    currentProvider = trimmed;
                    providerCount++;
                    if (providerCount <= 3) {
                        console.log(`[Provider] Line ${i}: "${trimmed}"`);
                    }
                    continue;
                }

                // Anything else
                if (i < 100 || !currentProvider) {
                    console.log(`[Unmatched] Line ${i}: "${trimmed.substring(0, 60)}"`);
                }
            }

            console.log(`\n[Debug] Filtered log lines: ${filteredCount}`);
            console.log(`[Debug] Providers found: ${providerCount}`);
            console.log(`[Debug] Models parsed: ${modelCount}`);

            const unique = [...new Set(models)].sort();
            resolve(unique);
        });
    });
}

async function main() {
    console.log('Fetching models from codetether...\n');
    const models = await listModelsViaCli();

    console.log(`✅ Found ${models.length} unique models\n`);

    if (models.length > 0) {
        console.log('First 20 models:');
        models.slice(0, 20).forEach((m, i) => {
            console.log(`  ${i + 1}. ${m}`);
        });
        console.log(`  ...\n`);
        console.log('Last 10 models:');
        models.slice(-10).forEach((m, i) => {
            console.log(`  ${models.length - 10 + i + 1}. ${m}`);
        });
    } else {
        console.log('⚠️  No models found!');
    }
}

main().catch(console.error);
