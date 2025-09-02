import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
    Field,
    LayerSchema,
    LayerSchemaResponse,
    Schema,
    SchemaColumn,
    SchemaFieldsRequest
} from "@type/Schema";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import { useMessageStore } from "@stores/useMessageStore";
import { diff } from "deep-object-diff";
import { buildLayerSchemaRequestsUsingPresence } from "@utils/schema";

interface SchemaState {
    currentSchema: LayerSchemaResponse | null;
    updated: SchemaFieldsRequest[] | null;
    isLoading: boolean;
    error: string | null;
}

interface SchemaActions {
    fetchSchema: () => Promise<void>;
    updateSchema: (layerName: string | undefined) => Promise<void>;
    setCurrentSchema: (layerName: string | undefined, layerSchema: LayerSchema) => SchemaFieldsRequest[] | null
    clearUpdates: () => void;
    getLayerSchemaByLayerName: (layerName: string | undefined) => LayerSchema | null
    getSchemaByNames: (layerName: string | undefined, schemaName: string | undefined) => Schema | null;
    getFieldByNames: (layerName: string | undefined, schemaName: string | undefined, fieldName: string | undefined) => Field | null;
    getSchemaColumns: (layerName: string | undefined, schemaName: string | undefined) => SchemaColumn[] | null;
    clearSchema: () => void;
}

const initialState: SchemaState = {
    currentSchema: null,
    updated: null,
    isLoading: false,
    error: null,
};

export const useSchemaStore = create<SchemaState & SchemaActions>()(
    immer((set, get) => ({
        ...initialState,
        fetchSchema: async () => {
            set((state) => {
                state.isLoading = true;
                state.error = null;
            });
            try {
                const config = apiConfig["SCHEMA_SETTING" as ApiMenuKey].list;
                const response = await axiosInstance({
                    method: config.method,
                    url: config.url
                });
                const data = response.data;
                console.log("schema response:::",data)
                set((state) => {
                    state.currentSchema = structuredClone(data);
                    state.updated = null;
                });

            } catch (e) {
                set((state) => {
                    state.error =  'An unknown error occurred';
                });
            } finally {
                set((state) => {
                    state.isLoading = false;
                });
            }
        },

        updateSchema: async (layerKey) => {
            const config = apiConfig["SCHEMA_SETTING" as ApiMenuKey].update;
            const setMessage = useMessageStore.getState().setMessage;

            const payload:SchemaFieldsRequest[] | null = get().updated;

            try {
                await axiosInstance({
                    method: config.method,
                    url: config.url.replace('{layer-key}', `${layerKey}`),
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

        setCurrentSchema: (layerName, editedLayer) => {
            if (!layerName) return null;
            const baselineLayer = get().getLayerSchemaByLayerName(layerName);
            if (!baselineLayer || !editedLayer) return null;

            const differences = diff(baselineLayer, editedLayer);
            console.debug("[diff] baseline vs edited:", differences);

            const dtos = buildLayerSchemaRequestsUsingPresence(baselineLayer, editedLayer);
            const payload = dtos.length > 0 ? dtos : null;

            set((state) => {
                state.updated = payload;
            });
            console.log("payload:", payload);
            return payload;
        },

        clearUpdates: () => {
            set((state) => state.updated = null);
        },

        getLayerSchemaByLayerName: (layerName) => {
            if (!layerName) return null;
            return get().currentSchema?.find(item => item.layerName === layerName) || null;
        },

        getSchemaByNames: (layerName, schemaName) => {
            if (!schemaName) return null;
            const layerSchema = get().getLayerSchemaByLayerName(layerName);
            return layerSchema?.schemata.find(schema => schema.name === schemaName) || null
        },

        getFieldByNames: (layerName, schemaName, fieldName) => {
            if (!fieldName) return null;
            const schema = get().getSchemaByNames(layerName, schemaName);
            return schema?.fields.find(field => field.name === fieldName) || null;
        },

        getSchemaColumns:(layerName) => {
            if(!layerName) return null;
            const layerSchema = get().getLayerSchemaByLayerName(layerName);
            return layerSchema?.schemaColumns || null;
        },

        clearSchema: () => {
            set(initialState);
        },
    }))
);
