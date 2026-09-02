/**
 * Selects an explicit model only while live discovery still reports it.
 *
 * An empty result asks Codetether to choose from its currently available
 * providers instead of forcing a stale cached provider/model identifier.
 */
export function availableCodetetherModel(
    requestedModel: string,
    availableModels: string[]
): string {
    const requested = requestedModel.trim();
    if (!requested) {
        return '';
    }

    const available = new Set(
        availableModels.map(model => model.trim()).filter(Boolean)
    );
    return available.has(requested) ? requested : '';
}
