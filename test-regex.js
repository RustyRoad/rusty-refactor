#!/usr/bin/env node

// Test the provider detection logic in isolation

const testLines = [
    "bedrock",
    "cerebras",
    "gemini-web",
    "github-copilot",
    "google",
    "minimax",
    "openai-codex",
    "openrouter",
    "stepfun",
    "vertex-anthropic",
    "vertex-glm",
    "zai",
    "  ai21.jamba-1-5-large-v1:0                       256k ctx     4k out",
    "  claude-3-5-sonnet-v2@20241022                   200k ctx     8k out",
];

console.log("Testing provider regex: /^[a-z0-9][\\w-]*$/i\n");

const regex = /^[a-z0-9][\w-]*$/i;

testLines.forEach(line => {
    const trimmed = line.trim();
    const isIndented = /^\s{2,}\S+/.test(line);
    const matchesProvider = regex.test(trimmed);

    console.log(`Line: "${trimmed}"`);
    console.log(`  Indented: ${isIndented}`);
    console.log(`  Matches provider regex: ${matchesProvider}`);
    console.log();
});
