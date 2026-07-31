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
import { modifyFeatureEventHandlers } from "@handler/modifyFeatureEventHandlers";
import { extractFeatureTypeFromGuid } from "@utils/guid";
import { saveNetworkDiffTileAware } from "@utils/networkDiff";
import { reconcileNetworkHistoryTileState } from "@utils/networkHistory";
import { NETWORK_TILING } from "@utils/lodConstants";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { useNetworkGridStore } from "@stores/useNetworkGridStore";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/PropertyPanel.module.css";
import {useWorkflowStore} from "@stores/useWorkflowStore";
import {useMenuStore} from "@stores/useMenuStore";
import DrilldownGrid from "@component/util/DrilldownGrid";
import SignalTodTimelineEditor from "@component/util/SignalTodTimelineEditor";
import SignalGroupedEditor from "@component/util/SignalGroupedEditor";

export interface PropertyPanelProps {
    activeSubmenu: MenuTreeResponse
    onClose: () => void;
}

/** 리사이즈 하한 — 이보다 낮으면 헤더/툴바만 남아 그리드가 사라진다 */
const MIN_PANEL_HEIGHT = 150;

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
    const tileMode = useNetworkTileStore((s) => s.tileMode);
    // 네트워크 타일 모드: currentJsonData 는 viewport working set 이라 그리드 전체 목록으로 쓸 수 없다.
    // /network/{versionId}/grid 전체 조회(useNetworkGridStore)를 별도 소스로 사용하고,
    // 조회 실패 시에만 기존 viewport 데이터 + 안내 배너로 폴백한다.
    const useFullGrid = isNetworkMenu && (NETWORK_TILING.ENABLED || tileMode);
    const networkGridData = useNetworkGridStore(useShallow((s) => s.data));
    const networkGridLoading = useNetworkGridStore((s) => s.loading);
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

    // 하단 Taskbar 오프셋은 CSS 변수(--taskbar-height)로 일원화되어 있다 —
    // App.tsx 컨테이너가 값을 공급하고 .overlay 가 bottom 으로 참조한다(개별 인라인 계산 없음).
    // 리사이즈 계산에는 px 값이 필요하므로 컨테이너에서 실제 값을 읽는다.
    const overlayRefForOffset = overlayRef;
    const readTaskbarOffset = useCallback((): number => {
        const el = overlayRefForOffset.current;
        if (!el) return 0;
        const raw = getComputedStyle(el).getPropertyValue("--taskbar-height").trim();
        const px = parseFloat(raw);
        return Number.isFinite(px) ? px : 0;
    }, [overlayRefForOffset]);

    // overlay 가 taskbar 위에서 실제로 쓸 수 있는 최대 높이(px).
    // overlay 의 컨테이닝 블록은 App.tsx 의 콘텐츠 컨테이너(= overlay 의 부모 노드)이고,
    // 그 하단에서 taskbar 두께만큼을 뺀 값이 곧 CSS 의 max-height 와 같은 값이다.
    const readAvailableHeight = useCallback((): number => {
        const host = overlayRef.current?.parentElement;
        if (!host) return 0;
        return Math.max(0, host.clientHeight - readTaskbarOffset());
    }, [readTaskbarOffset]);

    // 그리드/에디터에 넘길 실제 가용 높이 — header/handle/배너 높이를 상수로 빼는 대신
    // 실제 DOM 을 측정해 하드코딩(magic number)을 제거한다.
    const gridWrapRef = useRef<HTMLDivElement>(null);
    const [bodyHeight, setBodyHeight] = useState(0);
    useEffect(() => {
        const el = gridWrapRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect.height;
            if (typeof h === "number") setBodyHeight(Math.max(0, Math.round(h)));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [activeSubmenu.menuCode]);
    // 측정 전(첫 페인트)에는 패널 높이 기준 근사값 사용. 단 그 근사값도 taskbar 위 가용
    // 높이를 넘지 않게 잘라야 한다 — 넘긴 채로 그리드가 한 프레임이라도 그려지면 그만큼
    // 하단 row/스크롤바가 taskbar 뒤로 나간다.
    const containerHeight = bodyHeight > 0
        ? bodyHeight
        : Math.max(0, Math.min(height, readAvailableHeight() || height));

    // 창 축소·taskbar 등장으로 가용 높이가 줄면 저장된 패널 높이도 같이 줄인다.
    // (CSS max-height 가 표시 자체는 이미 막지만, 상태값이 과대하게 남아 있으면 첫 페인트
    //  근사값과 리사이즈 계산이 계속 과대값을 기준으로 삼는다.)
    useEffect(() => {
        const clamp = () => {
            const available = readAvailableHeight();
            if (available <= 0) return;
            setHeight(prev => {
                const next = Math.max(MIN_PANEL_HEIGHT, Math.min(prev, available));
                if (next !== prev) heightRef.current = next;
                return next;
            });
        };
        clamp();
        const raf = requestAnimationFrame(clamp);
        window.addEventListener("resize", clamp);
        const host = overlayRef.current?.parentElement;
        const ro = (host && typeof ResizeObserver !== "undefined")
            ? new ResizeObserver(() => clamp()) : null;
        if (host) ro?.observe(host);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", clamp);
            ro?.disconnect();
        };
    }, [readAvailableHeight]);

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

    // 패널을 새로 열 때 이전(다른 메뉴)의 선택을 정리한다. 단, 속성모달 "편집" 버튼으로 특정
    //   객체를 열었으면(pendingGridGuid) 그 선택을 지우지 말고 'grid' 소스로 확정해 그리드가
    //   해당 객체 depth 까지 진입·체크·스크롤하게 한다(setTimeout 없이 마운트 시점에 결정적으로 처리).
    // (A) 메뉴 전환 시 이전(다른 메뉴)의 선택 정리. 단, 속성모달 "편집" 진입(pendingGridGuid)이면
    //   여기서 지우지 않고 (B)가 "그리드 데이터가 준비된 뒤" 확정한다.
    useEffect(() => {
        const pending = useSelectionStore.getState().pendingGridGuid;
        if (!pending || pending.length === 0) clearSelected();
        // 메뉴 전환/닫힘 시 (B)가 소비하지 못한 pending 이 다음 그리드에 잘못 적용되지 않도록 정리.
        //   (현재 open 의 (B)는 이 cleanup 전에 실행되므로 영향 없음)
        return () => { useSelectionStore.getState().setPendingGridGuid(null); };
    }, [activeSubmenu]);

    // (B) 편집 진입 pending 선택을 "그리드 데이터가 준비된 시점"에 확정(체크·스크롤·드릴다운).
    //   ⚠️ 콜드스타트: 전체그리드(NETWORK 타일)는 networkGridData 가 async 로 로드되기 전까지
    //   viewport 폴백 데이터가 쓰이는데, 이 전환(폴백→전체그리드) 시 네비게이션이 리셋되며
    //   마운트 시점에 이미 소비한 선택이 사라진다. 그래서 실제 데이터가 준비된 뒤(pending 에서)
    //   적용해야 warm-start(데이터 즉시 존재)와 동일하게 동작한다.
    //   전체그리드는 networkGridData 로드 완료를, 그 외는 currentJsonData 존재를 준비 기준으로 본다.
    useEffect(() => {
        const pending = useSelectionStore.getState().pendingGridGuid;
        if (!pending || pending.length === 0) return;
        const dataReady = useFullGrid ? !!networkGridData : !!currentJsonData;
        if (!dataReady) return;
        useSelectionStore.getState().setSelectedGuid(pending, 'grid');
        useSelectionStore.getState().setPendingGridGuid(null);
    }, [useFullGrid, networkGridData, currentJsonData]);

    // 타일 모드 NETWORK: 편집 그리드 진입 시 전체 목록 로드 (viewport 와 무관)
    useEffect(() => {
        if (!useFullGrid) return;
        const versionKey = selectedScenarioVersion?.key;
        if (versionKey != null) useNetworkGridStore.getState().load(String(versionKey));
    }, [useFullGrid, selectedScenarioVersion?.key]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (rafRef.current !== null) return;

        rafRef.current = requestAnimationFrame(() => {
            // 패널 하단은 taskbar 위에 놓이므로(--taskbar-height) 커서까지의 높이에서 그만큼 뺀다
            const taskbarOffset = readTaskbarOffset();
            const newHeight = window.innerHeight - e.clientY - taskbarOffset;
            // 뷰포트 비율 상한(0.9)만으로는 부족하다 — 콘텐츠 컨테이너는 헤더(44px) 아래에서
            // 시작하므로 실제 가용 높이가 더 작다. 실측 가용 높이와 함께 낮은 쪽을 상한으로 쓴다.
            const available = readAvailableHeight();
            const maxHeight = Math.min(
                window.innerHeight * 0.9 - taskbarOffset,
                available > 0 ? available : Number.POSITIVE_INFINITY,
            );
            if (newHeight > MIN_PANEL_HEIGHT && newHeight < maxHeight) {
                heightRef.current = newHeight;
                if (overlayRef.current) {
                    overlayRef.current.style.height = `${newHeight}px`;
                }
            }
            rafRef.current = null;
        });
    }, [readTaskbarOffset, readAvailableHeight]);

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
            if (activeSubmenu.menuCode === 'NETWORK') {
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
            historyStore.getState().resetUpdateLogs();
            if (activeSubmenu.menuCode === 'NETWORK') {
                // 저장으로 서버 네트워크가 바뀌었으므로 전체 그리드 스냅샷 갱신
                useNetworkGridStore.getState().invalidate();
                if (useFullGrid) useNetworkGridStore.getState().load(String(versionKey), true);
            }
            setReloadFlag(prev => !prev);
            setMessage({ type: 'info', text: '저장 완료' });
        } catch (error) {
            setMessage({ type: 'error', text: '저장 실패: ' + error });
            throw error;
        }
    };

    // 평소 저장 = 지금 버전에 제자리 저장 (OD Matrix/PASSENGER와 동일하게 새 버전을 만들지 않음)
    const handleSaveBtn = () => {
        const logJson = historyStore.getState().updateLogs;
        if (!logJson || logJson.length === 0) {
            setMessage({ type: 'warn', text: '변경사항이 없습니다.' });
            return;
        }
        if (!selectedScenario || !selectedScenarioVersion) return;
        doSave(selectedScenarioVersion.key);
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

    return (
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
                        <div ref={gridWrapRef} className={styles.gridWrap}>
                            {useFullGrid && !networkGridData && networkGridLoading && (
                                <div className={styles.gridStaleBanner}>
                                    ℹ 전체 도로 목록을 불러오는 중입니다…
                                </div>
                            )}
                            {isNetworkMenu && gridDataFrozen && !(useFullGrid && networkGridData) && !networkGridLoading && (
                                <div className={`${styles.gridStaleBanner} ${gridDataOutOfRange ? styles.outOfRange : ""}`}>
                                    {gridDataOutOfRange
                                        ? "⚠ 목록이 현재 지도 화면 범위와 다릅니다 — 이전에 불러온 위치의 도로 데이터입니다. 최신 목록을 보려면 해당 위치로 줌인하세요."
                                        : "ℹ 줌아웃 상태입니다 — 목록은 마지막으로 불러온 화면 범위(줌인 상태)의 도로 데이터입니다. 실시간으로 갱신되지 않습니다."}
                                </div>
                            )}
                            {activeSubmenu.menuCode === "SIGNAL_TOD" ? (
                                <SignalTodTimelineEditor containerHeight={containerHeight} />
                            ) : activeSubmenu.menuCode === "SIGNAL" ? (
                                <SignalGroupedEditor containerHeight={containerHeight} />
                            ) : (
                                <DrilldownGrid
                                    layerName={submenu.item.layer}
                                    layerGroupName={"facility"}
                                    currentJsonData={useFullGrid && networkGridData ? networkGridData : currentJsonData}
                                    externalData={useFullGrid && !!networkGridData}
                                    containerHeight={containerHeight}
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
