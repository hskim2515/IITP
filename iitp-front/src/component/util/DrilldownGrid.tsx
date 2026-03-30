import React, { memo, useCallback, useEffect, useState, useMemo } from "react";

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
import { getChildrenStructure, getStructureByFeatureType } from "@component/util/JsonGrid";

type DrilldownGridProps = {
    layerName: string;
    layerGroupName: string;
    /** 전체 데이터 객체 { nodes: [], links: [] } */
    currentJsonData?: Record<string, any[]>;
    containerHeight?: number;
};

const DrilldownGrid = ({
                           layerName,
                           layerGroupName,
                           currentJsonData,
                           containerHeight = 600,
                       }: DrilldownGridProps) => {
    const setMessage = useMessageStore.getState().setMessage;
    const dataStore = layerNameToStoreMap[layerName];
    const historyStore = layerNameToHistoryStoreMap[layerName];

    const { init, clear, stack } = useNavigationStore();
    const frame = useCurrentFrame();

    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const clearSelected = useSelectionStore((s) => s.clearSelected);

    const { getSchemaDefinitionByNames, getStructureByLayerName } = useSchemaStore();

    // ── 내부 루트 탭 상태 관리 ──────────────────────────────────
    const rootKeys = useMemo(() => Object.keys(currentJsonData ?? {}), [currentJsonData]);
    const [activeRootKey, setActiveRootKey] = useState<string | null>(null);

    useEffect(() => {
        if (rootKeys.length > 0) {
            setActiveRootKey(rootKeys[0]);
        }
    }, [rootKeys]);

    useEffect(() => {
        if (!activeRootKey || !currentJsonData || !currentJsonData[activeRootKey]) return;

        const rowData = currentJsonData[activeRootKey];
        const layerStructure = getStructureByLayerName(layerName);
        const rootStructure = getStructureByFeatureType(layerStructure, activeRootKey);
        const children = getChildrenStructure(rootStructure);

        init({
            levelName: activeRootKey,
            rows: rowData,
            breadLabel: activeRootKey,
            hasChildren: children.length > 0,
        });

        clearSelected();

        return () => { };
    }, [layerName, activeRootKey, currentJsonData, init, clearSelected]);

    useEffect(() => {
        return () => clear();
    }, [layerName, clear]);

    // ── 셀 업데이트 ─────────────────────────────────────────────
    const handleCellUpdate = useCallback(
        (record: any, partial: Partial<Record<string, any>>) => {
            const merged = { ...record, ...partial };
            dataStore.getState().updateCurrentJsonData(merged, historyStore);
        },
        [dataStore, historyStore]
    );

    // ── 추가/삭제/저장 핸들러 ────────────────────────────────────
    const handleAdd = useCallback(() => {
        if (!frame) return;
        const TOOLBAR_HEIGHT = 44;
        const tableAreaHeight = containerHeight - TOOLBAR_HEIGHT;

        const targetSchema = getSchemaDefinitionByNames(layerName, frame.levelName);
        const template = generateTemplate(targetSchema);
        if (!template) {
            setMessage({ type: "error", text: "레이어에 스키마가 정의되어 있지 않습니다." });
            return;
        }
        const tempRecord: Record<string, any> = {
            ...template,
            featureType: frame.levelName,
            id: Date.now(),
            __guid: undefined,
            parentGuid: frame.parentGuid ?? null,
        };
        generateGuidWithParentGuid(frame.parentGuid, tempRecord, frame.rows);
        createEventHandlers(tempRecord);
    }, [frame, layerName, getSchemaDefinitionByNames, setMessage]);

    const handleDelete = useCallback(() => {
        if (!selectedGuid || selectedGuid.length === 0) {
            setMessage({ type: "warn", text: "삭제할 항목을 선택해주세요." });
            return;
        }
        dataStore.getState().removeRecordsByGuid(selectedGuid, historyStore);
        setMessage({ type: "info", text: `${selectedGuid.length}개 항목이 삭제되었습니다.` });
        clearSelected();
    }, [selectedGuid, dataStore, historyStore, clearSelected, setMessage]);

    const handleSave = useCallback(() => {
        dataStore.getState().save?.();
    }, [dataStore]);

    if (!frame) return null;

    return (
        <div className={style.container}>
            {/*{stack.length === 1 && rootKeys.length > 1 && (*/}
            {/*    <div className={style.rootTabHeader}>*/}
            {/*        {rootKeys.map((key) => (*/}
            {/*            <button*/}
            {/*                key={key}*/}
            {/*                className={activeRootKey === key ? style.activeTab : style.tab}*/}
            {/*                onClick={() => setActiveRootKey(key)}*/}
            {/*            >*/}
            {/*                {key.toUpperCase()} ({currentJsonData?.[key]?.length ?? 0})*/}
            {/*            </button>*/}
            {/*        ))}*/}
            {/*    </div>*/}
            {/*)}*/}

            <GridToolbar
                onAdd={handleAdd}
                onDelete={handleDelete}
                onSave={handleSave}
                rootKeys={rootKeys}
                activeRootKey={activeRootKey ?? ""}
                onRootChange={setActiveRootKey}
            />

            <div className={style.tableWrap}>
                <GridTable
                    layerName={layerName}
                    layerGroupName={layerGroupName}
                    frame={frame}
                    containerHeight={containerHeight }
                    onCellUpdate={handleCellUpdate}
                />
            </div>
        </div>
    );
};

export default DrilldownGrid;