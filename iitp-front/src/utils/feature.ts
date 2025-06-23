interface MergeFeatureOptions {
    baseFeatureProperties: Record<string, unknown>;
    newFeatureProperties: Record<string, unknown>;
}

export function mergeFeatureProperties({
                                           baseFeatureProperties,
                                           newFeatureProperties
}: MergeFeatureOptions): { [p: string]: unknown } {
    return {
        ...baseFeatureProperties,
        ...newFeatureProperties,
    };
}
