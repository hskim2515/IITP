import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import axiosInstance from '@api/axiosInstance';
import { apiConfig, ApiMenuKey } from '@config/apiConfig';
import { useMessageStore } from '@stores/useMessageStore';
import { buildLayerSchemaRequests, generateTemplate } from '@utils/schema';
import {
    LayerSchemaFieldResponse,
    LayerSchemaResponse, SchemaColumn,
    SchemaDefinition,
    SchemaFieldsRequest, SchemaStructure
} from "@type/openapi.gen";

interface SchemaState {
    currentSchema: LayerSchemaResponse[] | null;
    updated: SchemaFieldsRequest[] | null;
    isLoading: boolean;
    error: string | null;
}

interface SchemaActions {
    fetchSchema: () => Promise<void>;
    updateSchema: (layerName: string) => Promise<void>;
    setCurrentSchema: (layerName: string, layerSchema: LayerSchemaResponse) => SchemaFieldsRequest[] | null
    clearUpdates: () => void;

    getLayerSchemaByLayerName: (layerName: string) => LayerSchemaResponse | null
    getSchemaDefinitionByNames: (layerName: string, schemaName: string) => SchemaDefinition | null;
    getFieldByNames: (layerName: string, schemaName: string, fieldName: string) => LayerSchemaFieldResponse | null;
    getSchemaColumnSpecByLayerName: (layerName: string) => SchemaColumn[] | null;

    getStructureByLayerName: (layerName: string) => SchemaStructure[] | null;
    getStructureByNames: (layerName: string, structureName: string) => SchemaStructure | null;

    generateTemplateWithLayerNameAndFeatureType: (layerName: string, featureType: string) => Record<string, unknown> | undefined;
    clearSchema: () => void;
}

const initialState: SchemaState = {
    currentSchema: null,
    updated: null,
    isLoading: false,
    error: null,
};

export const useSchemaStore = create<SchemaState & SchemaActions>()(
    subscribeWithSelector(
        (set, get) => ({
                ...initialState,
                fetchSchema: async () => {
                    set({ isLoading: true, error: null });
                    try {
                        const config = apiConfig["SCHEMA_SETTING" as ApiMenuKey]?.list;
                        const response = await axiosInstance({
                            method: config?.method,
                            url: config?.url
                        });
                        const data: LayerSchemaResponse[] = response.data;
                        console.log("schema response:::", data);
                        set({
                            currentSchema: structuredClone(data),
                            updated: null
                        });
                    } catch (e) {
                        set({ error: 'An unknown error occurred' });
                    } finally {
                        set({ isLoading: false });
                    }
                },
                updateSchema: async (layerKey) => {
                    const setMessage = useMessageStore.getState().setMessage;
                    const payload = get().updated;

                    if (!payload || payload.length === 0) {
                        setMessage({ type: 'info', text: '저장할 변경 사항이 없습니다.' });
                        return;
                    }

                    try {
                        const config = apiConfig["SCHEMA_SETTING" as ApiMenuKey]?.update;
                        await axiosInstance({
                            method: config?.method,
                            url: config?.url.replace('{layer-key}', `${layerKey}`),
                            data: payload,
                        });
                        setMessage({
                            type: 'info',
                            text: '저장 완료',
                        });
                        await get().fetchSchema();
                    } catch (e) {
                        setMessage({
                            type: 'error',
                            text: '저장 실패: ' + e,
                        });
                    }
                },
                setCurrentSchema: (layerName, layerSchema) => {
                    if (!layerName) return null;
                    const baselineLayer = get().getLayerSchemaByLayerName(layerName);
                    if (!baselineLayer) return null;

                    const payload = buildLayerSchemaRequests(baselineLayer, layerSchema);


                    const hasUpdates = payload.length > 0;
                    set({ updated: hasUpdates ? payload : null });

                    return hasUpdates ? payload : null;
                },
                clearUpdates: () => {
                    set({ updated: null });
                },
                getLayerSchemaByLayerName: (layerName) => {
                    if (!layerName || !get().currentSchema) return null;
                    return get().currentSchema?.find(item => item.layerName === layerName) || null;
                },
                getSchemaDefinitionByNames: (layerName, schemaName) => {
                    if (!schemaName) return null;
                    const layerSchema = get().getLayerSchemaByLayerName(layerName);
                    return layerSchema?.definition?.find((schema: SchemaDefinition) => schema.name === schemaName) || null
                },
                getFieldByNames: (layerName, schemaName, fieldName) => {
                    if (!fieldName) return null;
                    const schema = get().getSchemaDefinitionByNames(layerName, schemaName);
                    return schema?.fields?.find((field:LayerSchemaFieldResponse) => field.name === fieldName) || null;
                },
                getSchemaColumnSpecByLayerName: (layerName) => {
                    if (!layerName) return null;
                    const layerSchema = get().getLayerSchemaByLayerName(layerName);
                    return layerSchema?.schemaColumns || null;
                },

                getStructureByLayerName: (layerName) => {
                    if (!layerName) return null;
                    const layerSchema = get().getLayerSchemaByLayerName(layerName);
                    return layerSchema?.structure || null;
                },
                getStructureByNames: (layerName, structureName) => {
                    if (!structureName) return null;
                    const structures = get().getStructureByLayerName(layerName);
                    return structures?.find((structure: SchemaStructure) => structure.name === structureName) || null;
                },

                generateTemplateWithLayerNameAndFeatureType: (layerName, featureType) => {
                    if(!layerName || !featureType) return;
                    const schema = get().getSchemaDefinitionByNames(layerName ,featureType)
                    return generateTemplate(schema);
                },
                clearSchema: () => {
                    set(initialState);
                },
            }
        )
    )
);