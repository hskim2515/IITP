import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import { propertyFormSchema } from "@schema/propertyFormSchema";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import VectorLayer from "ol/layer/Vector";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import {faChevronDown, faChevronUp, faMinus} from "@fortawesome/free-solid-svg-icons";
import { faClose } from "@fortawesome/free-solid-svg-icons/faClose";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import useHistoryInit, { menuCodeToHistoryStoreMap } from "@hooks/useHistoryInit";
import { mergeJsonWithLogRecursive, mergeUpdateLogs } from "@utils/history";
import HistoryController from "@component/modal/HistoryController";
import HistoryModal from "@component/modal/HistoryModal";
import { useScenarioStore } from "@stores/useScenarioStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import deepEqual from "deep-equal";
import { FeatureLayerAPI, isFeatureLayer } from "@features/FeatureLayerAPI";
import { matchesCustomKeyValue } from "@utils/olLayer";
import { useMessageStore } from "@stores/useMessageStore";
import { useShallow } from "zustand/react/shallow";
import { useEventStore } from "@stores/useEventStore";
import { modifyFeatureEventHandlers } from "@handler/modifyFeatureEventHandlers";
import { extractFeatureTypeFromGuid } from "@utils/guid";
import { saveNetworkDiffTileAware } from "@utils/networkDiff";
import { reconcileNetworkHistoryTileState } from "@utils/networkHistory";
import { NETWORK_TILING } from "@utils/lodConstants";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/PropertyPanel.module.css";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import {useMenuStore} from "@stores/useMenuStore";
import DrilldownGrid from "@component/util/DrilldownGrid";
import SignalPropertyPanelController, {
    SignalPropertyPanelContext,
} from "@component/panel/SignalPropertyPanelController";
import { HistoryStoreFactoryType } from "@stores/useHistoryStoreFactory";
import { UpdateLogEntry } from "@type/HistoryTypes";
import { SignalHistoryScope } from "@utils/signalHistory";

export interface PropertyPanelProps {
    activeSubmenu: MenuTreeResponse
    onClose: () => void;
}

interface SaveMenuDataOptions {
    logs?: UpdateLogEntry;
    historyStoresToReset?: HistoryStoreFactoryType[];
}

const PropertyPanel = ({ activeSubmenu, onClose }: PropertyPanelProps) => {
    const submenu = {
        item: propertyFormSchema[activeSubmenu.menuCode],
    };

    const store = menuCodeToStoreMap[activeSubmenu.menuCode];
    const selectedGuid = useSelectionStore(useShallow((state) => state.selectedGuid));
    const clearSelected = useSelectionStore((state) => state.clearSelected);
    const selectedGuidRef = useRef<(string | number | React.Key)[]>([]);
    const historyStore = menuCodeToHistoryStoreMap[activeSubmenu.menuCode];

    const currentJsonData = store(useShallow((state: { currentJsonData: unknown }) => state.currentJsonData));
    // 네트워크 타일 모드: 줌아웃(overview/mid)에서는 편집 그리드가 "마지막으로 불러온 화면 범위"
    // 데이터를 그대로 유지한다(NetworkFeatureLayer.updateTiles 참고) — 실시간이 아님을 배너로 안내.
    const isNetworkMenu = activeSubmenu.menuCode === "NETWORK";
    const gridDataFrozen = useNetworkTileStore((s) => s.gridDataFrozen);
    const gridDataOutOfRange = useNetworkTileStore((s) => s.gridDataOutOfRange);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const selectedScenarioVersion = useScenarioStore.getState().selectedScenarioVersion;
    const olMap = useOpenLayersStore.state.map();

    const heightRef = useRef(400);
    const [height, setHeight] = useState(400);
    const rafRef = useRef<number | null>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const { minimizeSession, closeSession } = useWorkflowStore();
    const setActiveSubmenu = useMenuStore((s) => s.setActiveSubmenu);

    type BodySize = "mini" | "default" | "full";
    const [bodySize, setBodySize] = useState<BodySize>("default");
    const setMessage = useMessageStore.getState().setMessage;

    const layer = useMemo<FeatureLayerAPI & VectorLayer | undefined>(() => {
        const foundLayer = olMap?.getLayers().getArray()
            .find(layer => matchesCustomKeyValue(layer, 'layer', submenu.item.layer));
        if (foundLayer && isFeatureLayer(foundLayer)) return foundLayer;
        return undefined;
    }, [olMap, activeSubmenu.menuCode]);

    useEffect(() => {
        if (!selectedGuidRef || !layer) return;
        const prevGuids = selectedGuidRef.current;
        const nextGuids: (string | number | React.Key)[] = selectedGuid;
        if (deepEqual(prevGuids, nextGuids)) return;
        selectedGuidRef.current = nextGuids;
    }, [selectedGuid]);

    useEffect(() => {
        if (!submenu.item.layer) return;
        const featureTypeSet = new Set<string>(
            (selectedGuid ?? [])
                .map(extractFeatureTypeFromGuid)
                .filter((v): v is string => !!v)
        );
        const disposers: Array<() => void> = [];
        featureTypeSet.forEach((featureType) => {
            const dispose = modifyFeatureEventHandlers(featureType);
            if (typeof dispose === "function") disposers.push(dispose);
        });
        return () => {
            for (let i = disposers.length - 1; i >= 0; i--) {
                try { disposers[i](); } catch { }
            }
        };
    }, [selectedGuid, submenu.item.layer]);

    useEffect(() => {
        clearSelected();
    }, [activeSubmenu, clearSelected]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (rafRef.current !== null) return;

        rafRef.current = requestAnimationFrame(() => {
            const newHeight = window.innerHeight - e.clientY - 35;
            if (newHeight > 150 && newHeight < window.innerHeight * 0.9) {
                heightRef.current = newHeight;
                // 내부 편집기도 containerHeight를 즉시 받아 드래그 중 함께 리사이즈한다.
                setHeight(newHeight);
                if (overlayRef.current) {
                    overlayRef.current.style.height = `${newHeight}px`;
                }
            }
            rafRef.current = null;
        });
    }, []);

    const stopResizing = useCallback(() => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
        document.body.style.userSelect = 'auto';
        document.body.style.cursor = '';
        setHeight(heightRef.current);
    }, [handleMouseMove]);

    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';
    }, [handleMouseMove, stopResizing]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', stopResizing);
            document.body.style.userSelect = 'auto';
            document.body.style.cursor = '';
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [handleMouseMove, stopResizing]);

    const [reloadFlag, setReloadFlag] = useState(false);
    useHistoryInit(reloadFlag);

    const saveMenuData = async (
        menuCode: string,
        versionKey: string,
        options?: SaveMenuDataOptions,
    ) => {
        const api = apiConfig[menuCode as ApiMenuKey]?.update;
        if (!api) return;
        const targetStore = menuCodeToStoreMap[menuCode];
        const targetHistoryStore = menuCodeToHistoryStoreMap[menuCode];
        const schemaItem = propertyFormSchema[menuCode];
        if (!targetStore || !targetHistoryStore || !schemaItem) return;

        const currentJson = targetStore.getState().currentJsonData;
        const logJson = targetHistoryStore.getState().updateLogs;
        const snapshotLogJson = targetHistoryStore.getState().snapshotUpdateLogs;
        const mergedLog = options?.logs ?? mergeUpdateLogs(logJson, snapshotLogJson);
        const payloadData = schemaItem.fullData ? currentJson : Object.values(currentJson)[0];
        const payload = { data: payloadData, logs: mergedLog };

        if (menuCode === 'NETWORK') {
            // 네트워크는 diff 저장 단일 진입점 (변경분만 전송 + 타일모드 삭제 id 합집합).
            // ⚠️ 타일 모드에서 전체 저장 폴백 금지 — viewport 일부가 전국 데이터를 덮어씀.
            const result = await saveNetworkDiffTileAware(versionKey);
            if (result === 'skipped') {
                if (NETWORK_TILING.ENABLED) throw new Error('diff 저장 불가 (타일 모드 — 전체 저장 폴백 금지)');
                await axiosInstance({ method: api.method, url: api.url + '/' + versionKey, data: payload });
            }
        } else {
            await axiosInstance({ method: api.method, url: api.url + '/' + versionKey, data: payload });
        }
        const historyStoresToReset = options?.historyStoresToReset ?? [targetHistoryStore];
        historyStoresToReset.forEach(history => {
            history.getState().resetUpdateLogs();
            history.getState().resetSnapshotUpdateLogs();
        });
        targetStore.getState().setChange(false);
    };

    // 평소 저장 = 지금 버전에 제자리 저장 (OD Matrix/PASSENGER와 동일하게 새 버전을 만들지 않음)
    const handleSaveBtn = async () => {
        if (!selectedScenario || !selectedScenarioVersion) return;
        const state = historyStore.getState();
        if (state.updateLogs.length === 0 && state.snapshotUpdateLogs.length === 0) {
            setMessage({ type: "warn", text: "변경사항이 없습니다." });
            return;
        }
        try {
            await saveMenuData(activeSubmenu.menuCode, selectedScenarioVersion.key);
            setReloadFlag(prev => !prev);
            setMessage({ type: "info", text: "저장 완료" });
        } catch (error) {
            setMessage({ type: "error", text: "저장 실패: " + error });
        }
    };

    const handleInitBtn = () => {
        if (!store || !historyStore) return;
        store.getState().initCurrentData();
        store.getState().setChange(false);
        historyStore.getState().resetAllHistoryStack();
        historyStore.getState().setCurrentSnapshotIndex(null);
    };

    const handleHistoryApply = (isUndo: boolean) => {
        if (!historyStore || !store) return;
        const historyFn = isUndo ? historyStore.getState().undo : historyStore.getState().redo;
        const updateHistory = historyFn();
        if (!updateHistory) {
            console.warn(isUndo ? "No more undo steps available." : "No more redo steps available.");
            return;
        }
        const currentJsonData = store.getState().currentJsonData;
        const mergeJsonData = mergeJsonWithLogRecursive(currentJsonData, updateHistory, isUndo);
        store.getState().setCurrentJsonData(mergeJsonData);

        // 타일 모드 네트워크: 삭제 마스크(MVT)·diff 삭제 목록도 로그 의미에 맞게 되돌림/재적용
        if (activeSubmenu.menuCode === 'NETWORK') {
            reconcileNetworkHistoryTileState(updateHistory, isUndo);
        }

        // updateLogs가 비었으면(모두 되돌림) isChanged 해제
        const remainingLogs = historyStore.getState().updateLogs;
        const remainingSnapshot = historyStore.getState().snapshotUpdateLogs;
        store.getState().setChange(remainingLogs.length > 0 || remainingSnapshot.length > 0);

        setMessage({ type: 'info', text: isUndo ? "Undo 성공" : "Redo 성공" });
    };

    const bodyClass =
        bodySize === "full" ? styles.bodyFull
            : bodySize === "mini" ? styles.bodyMini
                : styles.body;

    interface PanelContext {
        historyMenuCode: string;
        historyStore?: HistoryStoreFactoryType;
        historyScope?: SignalHistoryScope;
        content: React.ReactNode;
        onSave: () => void | Promise<void>;
        onInit: () => void;
        onHistoryApply: (isUndo: boolean) => void;
    }

    const renderPanel = (context: PanelContext) => (
        <>
        <div ref={overlayRef} className={styles.overlay} style={{ height: `${height}px` }}>
            <div className={styles.panel}>
                {/* Resize handle */}
                <div
                    className={styles.handle}
                    onMouseDown={startResizing}
                >
                    <div className={styles.handleBar}/>
                </div>

                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.titleWrap}>
                        <div className={styles.titleDot}/>
                        <span className={styles.title}>{activeSubmenu.nameKor}</span>
                    </div>

                    <div className={styles.actionGroup}>
                        <button className={styles.revertBtn} onClick={context.onInit} title="초기 데이터로 되돌리기">
                            되돌리기
                        </button>
                        <HistoryController onHistoryAply={context.onHistoryApply}/>
                        <button className={styles.historyBtn} onClick={() => setIsHistoryOpen(true)}>
                            변경 이력
                        </button>
                        <div className={styles.divider}/>
                        <button className={styles.saveBtn} onClick={context.onSave}>
                            저장
                        </button>
                    </div>

                    <div className={styles.controls}>
                        {/*{bodySize !== "full" && (*/}
                        {/*    <button className={styles.iconBtn} onClick={() => setBodySize(prev => prev === "mini" ? "default" : "full")} title="확장">*/}
                        {/*        <FontAwesomeIcon icon={faChevronUp} />*/}
                        {/*    </button>*/}
                        {/*)}*/}
                        {/*{bodySize !== "mini" && (*/}
                        {/*    <button className={styles.iconBtn} onClick={() => setBodySize(prev => prev === "full" ? "default" : "mini")} title="축소">*/}
                        {/*        <FontAwesomeIcon icon={faChevronDown} />*/}
                        {/*    </button>*/}
                        {/*)}*/}
                        <button className={styles.closeIconBtn} onClick={() => { minimizeSession(activeSubmenu.menuCode); setActiveSubmenu(null); }} title="최소화">
                            <FontAwesomeIcon icon={faMinus}/>
                        </button>

                        <button className={styles.closeIconBtn} onClick={() => { closeSession(activeSubmenu.menuCode); setActiveSubmenu(null); }} title="닫기">
                            <FontAwesomeIcon icon={faClose}/>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className={bodyClass}>
                    {isHistoryOpen && activeSubmenu.menuCode && (
                        <HistoryModal
                            onClose={() => setIsHistoryOpen(false)}
                            open={isHistoryOpen}
                            menuCode={context.historyMenuCode}
                            historyStoreOverride={context.historyStore}
                            historyScope={context.historyScope}
                        />
                    )}
                    {submenu.item?.layer && (
                        <div className={styles.gridWrap}>
                            {isNetworkMenu && gridDataFrozen && (
                                <div className={`${styles.gridStaleBanner} ${gridDataOutOfRange ? styles.outOfRange : ""}`}>
                                    {gridDataOutOfRange
                                        ? "⚠ 목록이 현재 지도 화면 범위와 다릅니다 — 이전에 불러온 위치의 도로 데이터입니다. 최신 목록을 보려면 해당 위치로 줌인하세요."
                                        : "ℹ 줌아웃 상태입니다 — 목록은 마지막으로 불러온 화면 범위(줌인 상태)의 도로 데이터입니다. 실시간으로 갱신되지 않습니다."}
                                </div>
                            )}
                            {context.content}
                        </div>
                    )}
                </div>
            </div>
        </div>
        </>
    );

    if (activeSubmenu.menuCode === "SIGNAL" || activeSubmenu.menuCode === "SIGNAL_TOD") {
        return (
            <SignalPropertyPanelController
                menuCode={activeSubmenu.menuCode}
                containerHeight={height}
                saveMenuData={saveMenuData}
                onSaved={() => setReloadFlag(prev => !prev)}
            >
                {(context: SignalPropertyPanelContext) => renderPanel(context)}
            </SignalPropertyPanelController>
        );
    }

    return renderPanel({
        historyMenuCode: activeSubmenu.menuCode,
        content: (
            <DrilldownGrid
                layerName={submenu.item.layer}
                layerGroupName={"facility"}
                currentJsonData={currentJsonData}
                containerHeight={height}
            />
        ),
        onSave: handleSaveBtn,
        onInit: handleInitBtn,
        onHistoryApply: handleHistoryApply,
    });
};

export default PropertyPanel;
