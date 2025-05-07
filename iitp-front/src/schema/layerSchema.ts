// layer/localLayerSchema.ts
export interface LocalLayerFieldSchema {
    type?: 'checkbox' | 'radio';
    providers?: ['satellite', 'hybrid'];
}

export const localLayerSchema: Record<string, LocalLayerFieldSchema> = {
    osm:        { type: 'radio' },
    base:       { type: 'radio' },
    satellite:  { type: 'radio' },
    hybrid:     { type: 'radio', providers: ['satellite', 'hybrid'] },
    heatmap:    { type: 'checkbox' },
    trip:       { type: 'checkbox' },
    od:       { type: 'checkbox' },
    facility1:  { type: 'checkbox' },
    facility2:  { type: 'checkbox' },
    facility3:  { type: 'checkbox' },
};
