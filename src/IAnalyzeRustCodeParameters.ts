/**
 * Input parameters for the analyze_rust_code tool
 */

export interface IAnalyzeRustCodeParameters {
    /**
     * The absolute file path of the Rust source file to analyze
     */
    filePath: string;

    /**
     * The starting line number to analyze (1-based)
     */
    startLine: number;

    /**
     * The ending line number to analyze (1-based, inclusive)
     */
    endLine: number;
}
