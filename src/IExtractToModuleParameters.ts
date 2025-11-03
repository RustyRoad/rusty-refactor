/**
 * Input parameters for the extract_to_module tool
 */

export interface IExtractToModuleParameters {
    /**
     * The absolute file path of the Rust source file containing the code to extract
     */
    sourceFilePath: string;

    /**
     * The starting line number of the code to extract (1-based)
     * NOTE: Line numbers may be stale after previous extractions.
     * Prefer using functionName when possible for more reliable extraction.
     */
    startLine: number;

    /**
     * The ending line number of the code to extract (1-based, inclusive)
     * NOTE: Line numbers may be stale after previous extractions.
     */
    endLine: number;

    /**
     * The name of the function/struct/enum to extract (preferred over line numbers)
     * If provided, will search for this symbol instead of using line numbers.
     * This is more reliable for sequential extractions.
     */
    functionName?: string;

    /**
     * The name of the module to create (must be snake_case)
     */
    moduleName: string;

    /**
     * The relative path where the module should be created (e.g., "src/models/my_module.rs")
     * Optional - if not provided, will use default path from settings
     */
    modulePath?: string;
}
