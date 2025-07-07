import { buildNewRow, featureToFlatRow } from "@utils/grid";
import {CellValueChangedEvent, ColDef} from "ag-grid-community";
import { FeatureStoreFactoryType } from "@stores/useFeatureStoreFactory";
import { RefObject } from "react";
import { GridHandle } from "@type/GirdOptions";
import { Feature } from "ol";
import { GeoJSON } from "ol/format";
import {HistoryStoreFactoryType} from "@stores/useHistoryStoreFactory";
import {featureUpdateLogs} from "@utils/history";
import {interpolateByOffset} from "@utils/interpolateByOffset";

export interface AddOptions {
    baseData: Record<string, unknown>,
    defaultGeometry?: Record<string, unknown>
    defaultProperties?: Record<string, unknown>
}

const useGrid = (gridRef: RefObject<GridHandle>, store: FeatureStoreFactoryType, historyStore: HistoryStoreFactoryType, colDefs: ColDef) => {

    // const addRow = ({
    //                     baseData, defaultGeometry
    //                 }: AddOptions) => {
    //
    //     const id = Date.now();
    //     const props = { id };
    //
    //     console.log("useGrid baseData:::", baseData)
    //     console.log("useGrid defaultGeometry:::", defaultGeometry)
    //     const geometry = defaultGeometry ?? null;
    //
    //     const newFeature: GeoJSON.Feature = {
    //         type: "Feature",
    //         geometry,
    //         properties: props,
    //     };
    //
    //     const prevGeojson = store.getState().currentGeojson;
    //     const updatedGeojson = {
    //         type: "FeatureCollection",
    //         features: [ ...(prevGeojson?.features ?? []), newFeature ]
    //     };
    //
    //     const newRow = buildNewRow({ colDefs, defaultData: featureToFlatRow(newFeature) });
    //     const updatedRows = [ ...store.getState().flatRow, newRow ];
    //
    //     store.getState().setCurrentGeojson(updatedGeojson);
    //     store.getState().setFlatRow(updatedRows);
    //     gridRef.current?.addRow(newRow);
    // };

    const addRow = ({
                        baseData, defaultGeometry, defaultProperties
                    }: AddOptions) => {
        const id = defaultProperties.id;
        console.log("useGrid baseData:::", baseData)
        console.log("useGrid defaultGeometry:::", defaultGeometry)
        console.log("useGrid defaultProperties:::", defaultProperties)
        const geometry = defaultGeometry ?? null;
        const properties = defaultProperties ?? null;

        const newFeature: GeoJSON.Feature = {
            type: "Feature",
            geometry,
            properties
        };

        const prevGeojson = store.getState().currentGeojson;
        const updatedGeojson = {
            type: "FeatureCollection",
            features: [ ...(prevGeojson?.features ?? []), newFeature ]
        };

        const newRow = buildNewRow({ colDefs, defaultData: featureToFlatRow(newFeature) });
        const updatedRows = [ ...store.getState().flatRow, newRow ];

        store.getState().setCurrentGeojson(updatedGeojson);
        store.getState().setFlatRow(updatedRows);
        gridRef.current?.addRow(newRow);
        featureUpdateLogs(historyStore,{
            featureId: id,
            updateType: "added",
            properties
        });
    };

    const deleteSelected = () => {
        const selectedRows = gridRef.current?.getSelectedRow() ?? [];
        const selectedIds = selectedRows.map(row => row.id).filter(Boolean);

        const prevGeojson = store.getState().currentGeojson;
        const updatedGeojson = {
            ...prevGeojson,
            features: prevGeojson?.features.filter(f => !selectedIds.includes(f.properties?.id)) ?? []
        };

        const updatedRows = store.getState().flatRow.filter(row => !selectedIds.includes(row.id));

        store.getState().setCurrentGeojson(updatedGeojson);
        store.getState().setFlatRow(updatedRows);
        gridRef.current?.removeSelectedRow();

        selectedRows.forEach(row => {
            featureUpdateLogs(historyStore,{
                featureId: row.id,
                updateType: "deleted",
                properties: row
            });
        });
    };

    const saveModifiedFeatures = (features: Feature[]) => {
        const geojsonFormat = new GeoJSON();

        features.forEach((feature) => {
            const id = feature.get("id");
            if (!id) return;

            const geojsonFeature = geojsonFormat.writeFeatureObject(feature, {
                featureProjection: "EPSG:3857",
                dataProjection: "EPSG:4326"
            });

            const updatedRow = featureToFlatRow(geojsonFeature);
            if (!updatedRow.id) updatedRow.id = id;

            // Grid update
            gridRef.current?.setRowDataByField({ field: "id", value: id }, updatedRow);
            gridRef.current?.setSelectRowsWithField("id", id);

            // 상태 업데이트
            const updatedRows = store.getState().flatRow.map(row =>
                row.id === id ? updatedRow : row
            );
            const updatedGeojson = {
                ...store.getState().currentGeojson,
                features: (store.getState().currentGeojson?.features ?? []).map((f) =>
                    f.properties?.id === id ? geojsonFeature : f
                ),
            };

            store.getState().setFlatRow(updatedRows);
            store.getState().setCurrentGeojson(updatedGeojson);
        });
    };

    const updateFeatureByRow = (e:CellValueChangedEvent) => {
        console.log("updateFeatureByRow:::", updateFeatureByRow)
        const row = e.data;
        //const row = gridRef.current?.getChangedValue();
        if (!row || typeof row !== "object") return;

        const id = row.id;
        if (typeof id !== "string" && typeof id !== "number") return;

        const currentGeojson = store.getState().currentGeojson;
        if (!currentGeojson) return;

        const updatedFeatures = currentGeojson.features.map((feature) => {
            if (feature.properties?.id !== id) return feature;

            // geometry 갱신
            const newGeometry = {
                type: row.geometryType ?? feature.geometry?.type,
                coordinates: [
                    row.lon ?? feature.geometry?.coordinates?.[0],
                    row.lat ?? feature.geometry?.coordinates?.[1]
                ]
            };

            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    ...row,
                },
                geometry: newGeometry
            };
        });

        const format = new GeoJSON();

        const features = format.readFeatures({
            type: 'FeatureCollection',
            features: updatedFeatures
        }, {
            featureProjection: 'EPSG:3857'
        });

        const mergeFeature = interpolateByOffset(features);

        const geojsonStr = new GeoJSON().writeFeatures(mergeFeature, {
            featureProjection: "EPSG:3857",
            dataProjection: "EPSG:4326"
        });
        const geojsonObj = JSON.parse(geojsonStr);

        store.getState().setCurrentGeojson({
            ...currentGeojson,
            features: geojsonObj.features,
        });

        featureUpdateLogs(historyStore,{
            featureId: row.id,
            updateType: "modified",
            field: e.colDef.field,
            oldValue: e.oldValue,
            newValue: e.newValue
        });
    };

    const switchEditable = (active: boolean) => {
        gridRef.current?.switchEditable(active)
    }

    return {
        addRow,
        deleteSelected,
        saveModifiedFeatures,
        updateFeatureByRow,
        switchEditable
    };
};
export default useGrid;