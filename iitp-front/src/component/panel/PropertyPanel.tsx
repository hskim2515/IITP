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
import { computeNetworkDiff, isNetworkDiffEmpty } from "@utils/networkDiff";
import { NETWORK_TILING } from "@utils/lodConstants";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/PropertyPanel.module.css";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import {useMenuStore} from "@stores/useMenuStore";
import DrilldownGrid from "@component/util/DrilldownGrid";
import SignalTodTimelineEditor from "@component/util/SignalTodTimelineEditor";
import SignalGroupedEditor from "@component/util/SignalGroupedEditor";
import SaveVersionModal from "@component/modal/SaveVersionModal";

export interface PropertyPanelProps {
    activeSubmenu: MenuTreeResponse
    onClose: () => void;
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

    useEffect(() => { clearSelected(); }, [activeSubmenu]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (rafRef.current !== null) return;

        rafRef.current = requestAnimationFrame(() => {
            const newHeight = window.innerHeight - e.clientY - 35;
            if (newHeight > 150 && newHeight < window.innerHeight * 0.9) {
                heightRef.current = newHeight;
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
        setHeight(heightRef.current);
    }, [handleMouseMove]);

    const startResizing = useCallback((e: React.MouseEvent) => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        document.body.style.userSelect = 'none';
    }, [handleMouseMove, stopResizing]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);

    const [reloadFlag, setReloadFlag] = useState(false);
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    useHistoryInit(reloadFlag);

    const doSave = async (versionKey: string) => {
        const api = apiConfig[activeSubmenu.menuCode as ApiMenuKey]?.update;
        if (!api) return;
        const currentJson = store.getState().currentJsonData;
        const logJson = historyStore.getState().updateLogs;
        const snapshotLogJson = historyStore.getState().snapshotUpdateLogs;
        const mergedLog = mergeUpdateLogs(logJson, snapshotLogJson);
        const payloadData = submenu.item?.fullData ? currentJson : Object.values(currentJson)[0];
        const payload = { data: payloadData, logs: mergedLog };
        try {
            // 네트워크는 도메인 id 기반 diff 저장 시도 (전국 규모 대비 payload 축소).
            // 실패 시 기존 전체 저장으로 안전하게 폴백.
            const savedByDiff = activeSubmenu.menuCode === 'NETWORK'
                ? await trySaveNetworkDiff(versionKey)
                : false;
            if (!savedByDiff) {
                await axiosInstance({ method: api.method, url: api.url + '/' + versionKey, data: payload });
            }
            historyStore.getState().resetUpdateLogs();
            setReloadFlag(prev => !prev);
            setMessage({ type: 'info', text: '저장 완료' });
        } catch (error) {
            setMessage({ type: 'error', text: '저장 실패: ' + error });
        }
    };

    /**
     * 네트워크 diff 저장 시도. 성공 시 true, 미적용/실패 시 false(→ 호출측이 전체 저장 폴백).
     * originData(서버 원본) vs currentJsonData(편집본)를 id로 비교한 변경분만 전송.
     */
    const trySaveNetworkDiff = async (versionKey: string): Promise<boolean> => {
        try {
            const current = store.getState().currentJsonData as any;
            if (!current) return false;

            let diff;
            if (NETWORK_TILING.ENABLED) {
                // 타일 모드: originData(빈)와 비교 불가. viewport 링크/노드를 upsert(편집 안 한 것도
                // 동일값 upsert = 백엔드 id 교체라 무해), 삭제는 누적된 deletedRecords에서 id 추출.
                const deleted = (store.getState() as any).deletedRecords ?? [];
                diff = {
                    upsertLinks: current.links ?? [],
                    upsertNodes: current.nodes ?? [],
                    deleteLinkIds: deleted.filter((r: any) => r.featureType === 'links' && r.id != null).map((r: any) => r.id),
                    deleteNodeIds: deleted.filter((r: any) => r.featureType === 'nodes' && r.id != null).map((r: any) => r.id),
                };
                if (isNetworkDiffEmpty(diff)) return true;
            } else {
                // 비-타일 모드: originData vs current 전체 비교 (기존)
                const origin = store.getState().originData as any;
                if (!origin) return false;
                diff = computeNetworkDiff(origin, current);
                if (isNetworkDiffEmpty(diff)) return true;
            }
            await axiosInstance({
                method: 'POST',
                url: `/network/${versionKey}/diff`,
                data: diff,
            });
            (store.getState() as any).clearDeletedRecords?.(); // 저장 성공 → 삭제 누적 초기화
            return true;
        } catch (e) {
            console.warn('[PropertyPanel] diff 저장 실패 → 전체 저장 폴백', e);
            return false;
        }
    };

    const handleSaveBtn = () => {
        const logJson = historyStore.getState().updateLogs;
        if (!logJson || logJson.length === 0) {
            setMessage({ type: 'warn', text: '변경사항이 없습니다.' });
            return;
        }
        if (!selectedScenario) return;
        setVersionModalOpen(true);
    };

    const handleInitBtn = () => {
        store.getState().initCurrentData();
        store.getState().setChange(false);
        historyStore.getState().resetAllHistoryStack();
        historyStore.getState().setCurrentSnapshotIndex(null);
    };

    const handleHistoryApply = (isUndo: boolean) => {
        if (!historyStore) return;
        const historyFn = isUndo ? historyStore.getState().undo : historyStore.getState().redo;
        const updateHistory = historyFn();
        if (!updateHistory) {
            console.warn(isUndo ? "No more undo steps available." : "No more redo steps available.");
            return;
        }
        const currentJsonData = store.getState().currentJsonData;
        const mergeJsonData = mergeJsonWithLogRecursive(currentJsonData, updateHistory, isUndo);
        store.getState().setCurrentJsonData(mergeJsonData);

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

    return (
        <>
        <SaveVersionModal
            open={versionModalOpen}
            onConfirm={async (versionKey) => {
                setVersionModalOpen(false);
                await doSave(versionKey);
            }}
            onCancel={() => setVersionModalOpen(false)}
        />
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
                        <button className={styles.revertBtn} onClick={handleInitBtn} title="초기 데이터로 되돌리기">
                            되돌리기
                        </button>
                        <HistoryController onHistoryAply={handleHistoryApply}/>
                        <button className={styles.historyBtn} onClick={() => setIsHistoryOpen(true)}>
                            변경 이력
                        </button>
                        <div className={styles.divider}/>
                        <button className={styles.saveBtn} onClick={handleSaveBtn}>
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
                            menuCode={activeSubmenu.menuCode}
                        />
                    )}
                    {submenu.item?.layer && (
                        <div className={styles.gridWrap}>
                            {activeSubmenu.menuCode === "SIGNAL_TOD" ? (
                                <SignalTodTimelineEditor containerHeight={height} />
                            ) : activeSubmenu.menuCode === "SIGNAL" ? (
                                <SignalGroupedEditor containerHeight={height} />
                            ) : (
                                <DrilldownGrid
                                    layerName={submenu.item.layer}
                                    layerGroupName={"facility"}
                                    currentJsonData={currentJsonData}
                                    containerHeight={height}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
        </>
    );
};

export default PropertyPanel;
