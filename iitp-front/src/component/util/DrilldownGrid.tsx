import React, { useCallback, useEffect, useState, useMemo } from "react";

import { useNavigationStore, useCurrentFrame } from "@stores/useNavigationStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useSchemaStore } from "@stores/useSchemaStore";

import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { layerNameToHistoryStoreMap } from "@hooks/useHistoryInit";

import { generateGuidWithParentGuid } from "@utils/guid";
import { generateTemplate } from "@utils/schema";
import { createEventHandlers } from "@handler/createEventHandlers";
import { GridToolbar } from "./GridToolbar";
import { GridTable } from "./GridTable";

import style from "@css/DrilldownGrid.module.css";
import { getChildrenStructure, getStructureByFeatureType } from "@utils/gridUtils";

type DrilldownGridProps = {
    layerName: string;
    layerGroupName: string;
    currentJsonData?: Record<string, any[]>;
    containerHeight?: number;
};

function guidBelongsToRows(rows: any[], targetGuid: string): boolean {
    return rows.some(
        (row) => targetGuid === row.__guid || targetGuid.startsWith(`${row.__guid}.`)
    );
}

const DrilldownGrid = ({
                           layerName,
                           layerGroupName,
                           currentJsonData,
                           containerHeight = 600,
                       }: DrilldownGridProps) => {
    const setMessage = useMessageStore.getState().setMessage;
    const dataStore = layerNameToStoreMap[layerName];
    const historyStore = layerNameToHistoryStoreMap[layerName];

    const init = useNavigationStore((s) => s.init);
    const clear = useNavigationStore((s) => s.clear);
    const rebuildStack = useNavigationStore((s) => s.rebuildStack);
    const frame = useCurrentFrame();

    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const clearSelected = useSelectionStore((s) => s.clearSelected);

    const { getSchemaDefinitionByNames, getStructureByLayerName } = useSchemaStore();

    const rootKeys = useMemo(() => {
        const data = (currentJsonData ?? dataStore.getState().currentJsonData) as Record<string, any[]> | undefined;
        return Object.keys(data ?? {}).filter(key => Array.isArray((data as any)?.[key]));
    }, [currentJsonData, dataStore]);
    const [activeRootKey, setActiveRootKey] = useState<string | null>(null);

    useEffect(() => {
        if (rootKeys.length > 0 && !rootKeys.includes(activeRootKey ?? "")) {
            setActiveRootKey(rootKeys[0] ?? null);
        }
    }, [rootKeys, activeRootKey]);

    useEffect(() => {
        if (!selectedGuid?.length || !currentJsonData || !activeRootKey) return;
        const targetGuid = selectedGuid[0] as string;
        if (!targetGuid) return;

        const currentRows = currentJsonData[activeRootKey] ?? [];
        if (guidBelongsToRows(currentRows, targetGuid)) return;

        for (const key of rootKeys) {
            if (key === activeRootKey) continue;
            if (guidBelongsToRows(currentJsonData[key] ?? [], targetGuid)) {
                setActiveRootKey(key);
                return;
            }
        }
    }, [selectedGuid, currentJsonData, activeRootKey, rootKeys]);

    const syncNavigationFromData = useCallback((data: Record<string, any[]> | undefined) => {
        if (!activeRootKey || !data || !data[activeRootKey]) return;

        const rowData = data[activeRootKey];
        const layerStructure = getStructureByLayerName(layerName);
        const rootStructure = getStructureByFeatureType(layerStructure, activeRootKey);
        const children = getChildrenStructure(rootStructure);

        const currentStack = useNavigationStore.getState().stack;
        if (currentStack.length > 1 && currentStack[0].levelName === activeRootKey) {
            rebuildStack(rowData);
            return;
        }

        init({
            levelName: activeRootKey,
            rows: rowData,
            breadLabel: activeRootKey,
            hasChildren: children.length > 0,
        });

        const pendingGuid = useSelectionStore.getState().selectedGuid[0] as string | undefined;
        if (!pendingGuid || !guidBelongsToRows(rowData, pendingGuid)) {
            clearSelected();
        }
    }, [layerName, activeRootKey, init, rebuildStack, clearSelected, getStructureByLayerName]);

    // feature store를 직접 구독하여 currentJsonData 변경 시 즉시 네비게이션 동기화
    // (undo/redo 포함, React 렌더 사이클에 의존하지 않음)
    useEffect(() => {
        return dataStore.subscribe(
            (state: any) => state.currentJsonData,
            (newData: any) => {
                syncNavigationFromData(newData as Record<string, any[]>);
            }
        );
    }, [dataStore, syncNavigationFromData]);

    useEffect(() => {
        syncNavigationFromData(currentJsonData as Record<string, any[]>);
    }, [layerName, activeRootKey, currentJsonData, syncNavigationFromData]);

    useEffect(() => {
        return () => clear();
    }, [layerName, clear]);

    const handleCellUpdate = useCallback(
        (record: any, partial: Partial<Record<string, any>>) => {
            const merged = { ...record, ...partial };
            dataStore.getState().updateCurrentJsonData(merged, historyStore);
        },
        [dataStore, historyStore]
    );

    const handleAdd = useCallback(() => {
        const currentFrame = useNavigationStore.getState().stack.at(-1);
        if (!currentFrame) return;

        const targetSchema = getSchemaDefinitionByNames(layerName, currentFrame.levelName);
        const template = generateTemplate(targetSchema);
        if (!template) {
            setMessage({ type: "error", text: "레이어에 스키마가 정의되어 있지 않습니다." });
            return;
        }
        const tempRecord: Record<string, any> = {
            ...template,
            featureType: currentFrame.levelName,
            id: Date.now(),
            __guid: undefined,
            parentGuid: currentFrame.parentGuid ?? null,
        };
        generateGuidWithParentGuid(currentFrame.parentGuid, tempRecord, currentFrame.rows);
        createEventHandlers(tempRecord);
    }, [layerName, getSchemaDefinitionByNames, setMessage]);

    const handleDelete = useCallback(() => {
        const currentSelectedGuid = useSelectionStore.getState().selectedGuid;
        if (!currentSelectedGuid || currentSelectedGuid.length === 0) {
            setMessage({ type: "warn", text: "삭제할 항목을 선택해주세요." });
            return;
        }
        dataStore.getState().removeRecordsByGuid(currentSelectedGuid, historyStore);
        setMessage({ type: "info", text: `${currentSelectedGuid.length}개 항목이 삭제되었습니다.` });
        clearSelected();
    }, [dataStore, historyStore, clearSelected, setMessage]);

    const handleSave = useCallback(() => {
        dataStore.getState().save?.();
    }, [dataStore]);

    if (!frame) return null;

    return (
        <div className={style.container}>
            <GridToolbar
                onAdd={handleAdd}
                onDelete={handleDelete}
                onSave={handleSave}
                rootKeys={rootKeys}
                activeRootKey={activeRootKey ?? ""}
                onRootChange={(key) => {
                    clearSelected();
                    setActiveRootKey(key);
                }}
            />

            <div className={style.tableWrap}>
                <GridTable
                    key={`${frame.levelName}-${frame.parentGuid || 'root'}`}
                    layerName={layerName}
                    layerGroupName={layerGroupName}
                    frame={frame}
                    containerHeight={containerHeight}
                    onCellUpdate={handleCellUpdate}
                />
            </div>
        </div>
    );
};

export default DrilldownGrid;
