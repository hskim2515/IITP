import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import MapCesium from "@component/map/MapCesium";
import MapOL from "@component/map/MapOL";
import useMapInit from "@hooks/useMapInit";
import useSimulation from "@hooks/useSimulation";
import useMapSync from "@hooks/sync/useMapSync";
import { useNaverBaseMap } from "@hooks/useNaverBaseMap";
import { useNaverPanorama } from "@hooks/useNaverPanorama";
import useLayer from "@hooks/useLayer";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useMapStore } from "@stores/useMapStore";
import { useModeStore } from "@stores/useModeStore";
import useLayerInit from "@hooks/useLayerInit";
import useDefaultSelect from "@hooks/sync/select/useDefaultSelect";
import '../../App.css'
import useDefaultMoveMouse from "@hooks/sync/move/useDefaultMoveMouse";
import styles from "@css/Maps.module.css"
import Divider from "@component/map/Divider";
import ToolsPanel from "@component/tool/ToolsPanel";
import { useNetworkDraw } from "@hooks/useNetworkDraw";
import { useNetworkSelect } from "@hooks/useNetworkSelect";
import { usePlacementMode } from "@hooks/usePlacementMode";
import { useRouteDrawMode } from "@hooks/useRouteDrawMode";
import { useOsmBboxDraw } from "@hooks/useOsmBboxDraw";
import { useKtdbPolygonDraw } from "@hooks/useKtdbPolygonDraw";
import useNetworkStationModify from "@hooks/useNetworkStationModify";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import NetworkEditToolbar from "@component/tool/NetworkEditToolbar";
import RouteDrawToolbar from "@component/tool/RouteDrawToolbar";
import NetworkDrawSettingsBar from "@component/tool/NetworkDrawSettingsBar";
import { useCoordPick } from "@hooks/useCoordPick";
import { useOsmBboxStore } from "@stores/useOsmBboxStore";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import EditGuidePanel from "@component/util/EditGuidePanel";

// 3D 전용 테스트 모드 — true로 설정 시 OpenLayers 비활성화, Cesium만 실행
const ONLY_3D = false;

interface MapsProps {
    singleMapMode?: boolean;
}

const Maps = ({ singleMapMode = false }: MapsProps) => {
    const mapViewMode = useMapStore((s) => s.mapViewMode);
    const setMapViewMode = useMapStore((s) => s.setMapViewMode);

    useEffect(() => {
        if (ONLY_3D) setMapViewMode('3D');
    }, []);

    const isNetworkEditActive = useNetworkDrawStore(
        (s) => s.isActive || s.isSelectActive || s.placementMode !== 'none'
    );
    const coordPickActive = useMapStore((s) => s.coordPickCallback !== null);
    const selecting = useOsmBboxStore((s) => s.selecting);
    const selectingPolygon = useOsmBboxStore((s) => s.selectingPolygon);
    const prevModeRef = useRef<typeof mapViewMode | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openlayersMapRef = useRef<HTMLDivElement | undefined>(undefined);
    const cesiumMapRef = useRef<Element | null>(null);
    // 네이버 배경 지도 (읽기 전용, OL 아래 겹침). 배경지도로 '네이버' 선택 + 키 설정 시 활성.
    const naverMapRef = useRef<HTMLDivElement | null>(null);
    // 네이버 파노라마(거리뷰) 3D 배경 (readonly). 네이버 배경 선택 + 3D 표시 시 활성.
    const naverPanoRef = useRef<HTMLDivElement | null>(null);
    const currentBaseMap = useMapStore((s) => s.currentBaseMap);
    const appMode = useModeStore((s) => s.appMode);
    const naverKeyEnv = !!process.env.REACT_APP_NAVER_MAP_CLIENT_ID;
    const naverKeyed = naverKeyEnv && currentBaseMap === 'naver';
    const naverEnabled = naverKeyed; // 2D 배경(OL): 배경지도로 '네이버' 선택 시에만(편집/보기 무관)
    const isResizing = useRef(false);

    const [dividerX, setDividerX] = useState<number | null>(null);

    const {fetchLayerSchema, loading: schemaLoading} = useLayerSchemaStore();
    const isInitialized = useLayerStore((s) => s.isInitialized);
    const tileLoading = useNetworkTileStore((s) => s.loadingCount > 0);
    const bgTasks = useBackgroundTaskStore((s) => s.tasks);
    const bgTaskLabel = Object.values(bgTasks)[0] ?? null;
    const vpVehicles = useVehicleStore((s: any) => s.viewportVehicleInfo);

    useEffect(() => {
        if (!schemaLoading) fetchLayerSchema()
    }, [fetchLayerSchema]);

    useLayerInit();
    useMapInit(openlayersMapRef, cesiumMapRef);
    useSimulation();
    useMapSync();
    useNaverBaseMap(naverMapRef, naverEnabled);
    const roadviewEnabledInEdit = useMapStore((s) => s.roadviewEnabledInEdit);
    const setRoadviewEnabledInEdit = useMapStore((s) => s.setRoadviewEnabledInEdit);
    // 거리뷰 활성 조건:
    //   - 편집모드: 기본 꺼짐 — 사용자가 roadviewEnabledInEdit 를 직접 켜야 나타난다(편집 중
    //     2D 지도를 옮길 때마다 자동으로 따라다니는 게 거슬린다는 피드백으로 자동 노출을 없앰).
    //   - 보기모드: 네이버 배경 선택 시에만 로드뷰.
    //   공통: 3D 화면이 보일 때(mapViewMode !== '2D')만.
    const panoActive = naverKeyEnv && mapViewMode !== '2D' && ((appMode === 'edit' && roadviewEnabledInEdit) || naverKeyed);
    useNaverPanorama(naverPanoRef, panoActive);
    useLayer();
    useDefaultSelect();
    useDefaultMoveMouse();
    useNetworkDraw();
    useNetworkSelect();
    usePlacementMode();
    useRouteDrawMode();
    useNetworkStationModify();
    useOsmBboxDraw();
    useKtdbPolygonDraw();
    useCoordPick();

    const getContainerWidth = useCallback(() => {
        return containerRef.current?.clientWidth ?? 0;
    }, []);

    useEffect(() => {
        const width = getContainerWidth();
        if (width > 0) setDividerX((prev) => prev == null ? Math.round(width / 2) : prev)
    }, []);

    useEffect(() => {
        const onResize = () => {
            const width = getContainerWidth();
            if (width === 0) return;
            setDividerX((prev) => {
                if (prev == null) return Math.round(width / 2);
                return Math.min(Math.max(prev, 120), width - 120)
            })
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [getContainerWidth])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current || !containerRef.current) return;
            const containerLeft = containerRef.current?.getBoundingClientRect().left || 0;
            setDividerX(e.clientX - containerLeft);
        };

        const handleMouseUp = () => {
            isResizing.current = false;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    // OSM/KTDB bbox 선택(DragBox)·KTDB 폴리곤 그리기(Draw)·기준점 선택(coordPick)은 전부
    // OL(2D) 지도에만 리스너를 건다 — 3D(Cesium) 화면을 클릭해도 아무 반응이 없어 보이는
    // 문제를 막기 위해, 선택 모드에 들어가면 강제로 2D 단일 화면으로 전환해 클릭이 항상 OL로
    // 들어가게 한다. ⚠️ selectingPolygon 이 여기 빠져 있었다 — 폴리곤 그리기 중에도 분할/3D
    // 화면일 수 있어 그리려는 화면이 작거나(분할) 아예 안 보이는(3D 단일) 채로 두는 회귀였다.
    const forceOl2D = selecting || selectingPolygon || coordPickActive;
    useEffect(() => {
        if (forceOl2D) {
            prevModeRef.current = mapViewMode;
            setMapViewMode('2D');
        } else if (prevModeRef.current !== null) {
            setMapViewMode(prevModeRef.current);
            prevModeRef.current = null;
        }
    }, [forceOl2D]);

    const handleMouseDown = () => {
        isResizing.current = true;
    };

    const containerWidth = getContainerWidth();
    const leftWidth = `${dividerX}px`;
    const rightWidth = `${Math.max(containerWidth - (dividerX ?? 0), 0)}px`;

    // 편집모드 + 분할 화면에서 로드뷰를 꺼면(로드뷰가 없는/무의미한 구간) 3D 패널은
    // 그냥 평범한 3D 지도로 남는데, 편집은 2D에서 하므로 그 3D 패널이 화면 절반을
    // 차지할 이유가 없다 — 이때는 2D를 단일 모드처럼 전체 폭으로 확장한다.
    // (3D 단일 모드는 사용자가 명시적으로 3D를 보려고 고른 것이므로 대상에서 제외)
    const editRoadviewOffExpand2D =
        appMode === 'edit' && mapViewMode === 'split' && naverKeyEnv && !roadviewEnabledInEdit;

    // 두 지도를 absolute로 겹쳐두고 visibility로 전환.
    // width:0 으로 숨기면 WebGL 컨텍스트가 중단되어 preRender 이벤트가 멈추고
    // 시뮬레이션 업데이트 루프가 끊기기 때문에 이 방식을 사용.
    const useStackedLayout = singleMapMode || mapViewMode !== 'split' || editRoadviewOffExpand2D;
    const olVisible = mapViewMode !== '3D';
    const cesiumVisible = mapViewMode !== '2D' && !editRoadviewOffExpand2D;

    const olStyle = useStackedLayout
        ? {
            position: 'absolute' as const, inset: 0,
            visibility: olVisible ? 'visible' as const : 'hidden' as const,
            pointerEvents: olVisible ? 'auto' as const : 'none' as const,
            zIndex: olVisible ? 1 : 0,
          }
        : { width: leftWidth, transition: isResizing.current ? "none" : "width 0.3s ease" };

    const cesiumStyle = useStackedLayout
        ? {
            position: 'absolute' as const, inset: 0,
            visibility: cesiumVisible ? 'visible' as const : 'hidden' as const,
            pointerEvents: cesiumVisible ? 'auto' as const : 'none' as const,
            zIndex: cesiumVisible ? 1 : 0,
          }
        : { width: rightWidth, transition: isResizing.current ? "none" : "width 0.3s ease" };

    const isLoading = schemaLoading || !isInitialized;

    return (
        <div
            ref={containerRef}
            className={`${styles['container']} ${useStackedLayout ? styles['containerSingle'] : ''}`}
        >
            <EditGuidePanel/>
            {coordPickActive && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001,
                    background: 'rgba(30,100,220,0.88)',
                    color: '#fff',
                    padding: '9px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 13,
                    pointerEvents: 'none',
                }}>
                    <span>지도를 클릭하여 네트워크 기준점을 선택하세요</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>ESC: 취소</span>
                </div>
            )}

            {isLoading && (
                <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(8,10,20,0.85)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999,
                    gap: 16,
                }}>
                    <div style={{
                        width: 40, height: 40,
                        border: '3px solid rgba(255,255,255,0.15)',
                        borderTop: '3px solid rgba(100,160,255,0.9)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }}/>
                    <span style={{ fontSize: 13, color: 'rgba(200,210,230,0.8)', letterSpacing: 1 }}>
                        데이터 로딩 중...
                    </span>
                </div>
            )}
            {!isLoading && (tileLoading || bgTaskLabel) && (
                <div style={{
                    position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(8,10,20,0.82)',
                    borderRadius: 20,
                    padding: '7px 16px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    zIndex: 10000,
                    pointerEvents: 'none',
                }}>
                    <div style={{
                        width: 16, height: 16,
                        border: '2px solid rgba(255,255,255,0.15)',
                        borderTop: '2px solid rgba(100,160,255,0.9)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }}/>
                    <span style={{ fontSize: 12, color: 'rgba(200,210,230,0.9)' }}>
                        {bgTaskLabel ?? '네트워크 로딩 중...'}
                    </span>
                </div>
            )}
            {!isLoading && vpVehicles && (
                <div style={{
                    position: 'absolute', bottom: 14, left: 14,
                    background: 'rgba(8,10,20,0.78)',
                    borderRadius: 14,
                    padding: '5px 12px',
                    display: 'flex', alignItems: 'center', gap: 7,
                    zIndex: 9000,
                    pointerEvents: 'none',
                    fontSize: 12,
                    color: 'rgba(210,218,235,0.92)',
                }}>
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: vpVehicles.dense ? 'rgba(255,150,60,0.95)' : 'rgba(90,210,120,0.95)',
                    }}/>
                    {/* total/shown은 CZML 프리페치 시간창(최대 300초) 동안의 누적 통행량이라
                        그대로 보여주면 "차량이 안 보이는데 수백 대"로 오해를 준다(실측 보고) —
                        activeNow(±3초 실제 현재 차량 수, 별도 폴링)가 오면 그것을 우선 표시하고,
                        아직 안 왔으면(최초 로드 직후 짧은 순간) 기존 값으로 폴백한다. */}
                    {vpVehicles.dense
                        ? <span>현재 {(vpVehicles.activeNow ?? vpVehicles.total).toLocaleString()}대 — 히트맵 표시</span>
                        : <span>현재 {(vpVehicles.activeNow ?? vpVehicles.shown).toLocaleString()}대
                            {vpVehicles.total > vpVehicles.shown ? ` (최근 통행 ${vpVehicles.total.toLocaleString()}대)` : ''}</span>}
                </div>
            )}
            <ToolsPanel/>
            <NetworkEditToolbar/>
            <RouteDrawToolbar/>
            <NetworkDrawSettingsBar/>

            {!ONLY_3D && (
                <div className={styles.mapModeToggle} title={isNetworkEditActive ? '편집 모드 중 전환 불가' : undefined}>
                    <button
                        className={mapViewMode === '2D' ? styles.mapModeBtnActive : styles.mapModeBtn}
                        onClick={() => !isNetworkEditActive && setMapViewMode('2D')}
                        disabled={isNetworkEditActive}
                        style={isNetworkEditActive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    >
                        2D
                    </button>
                    {!singleMapMode && (
                        <button
                            className={mapViewMode === 'split' ? styles.mapModeBtnActive : styles.mapModeBtn}
                            onClick={() => !isNetworkEditActive && setMapViewMode('split')}
                            disabled={isNetworkEditActive}
                            style={isNetworkEditActive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        >
                            분할
                        </button>
                    )}
                    <button
                        className={mapViewMode === '3D' ? styles.mapModeBtnActive : styles.mapModeBtn}
                        onClick={() => !isNetworkEditActive && setMapViewMode('3D')}
                        disabled={isNetworkEditActive}
                        style={isNetworkEditActive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    >
                        3D
                    </button>
                </div>
            )}

            {/* 편집모드 로드뷰 on/off — 기본 꺼짐, 사용자가 명시적으로 켜야 표시된다.
                위치는 2D 지도 위 마커를 드래그해 옮길 수 있다(useNaverPanorama 참고). */}
            {!ONLY_3D && naverKeyEnv && appMode === 'edit' && mapViewMode !== '2D' && (
                <button
                    className={roadviewEnabledInEdit ? styles.mapModeBtnActive : styles.mapModeBtn}
                    onClick={() => setRoadviewEnabledInEdit(!roadviewEnabledInEdit)}
                    title={roadviewEnabledInEdit ? '로드뷰 끄기 (3D 지도로 전환)' : '로드뷰 켜기 (켠 뒤 2D 마커를 드래그해 위치 이동 가능)'}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 6 }}
                >
                    로드뷰 {roadviewEnabledInEdit ? 'ON' : 'OFF'}
                </button>
            )}

            {/* 네이버 배경 지도 (읽기 전용): OL 영역에 정확히 겹쳐 깔림(절대위치). OL 배경타일을 끄면 비쳐 보인다.
                분할 모드에서 OL 은 좌측 leftWidth 를 차지하므로 네이버도 그 폭에 맞춘다. */}
            {!ONLY_3D && naverEnabled && (
                <div
                    ref={naverMapRef}
                    style={{
                        position: 'absolute' as const,
                        top: 0, left: 0, bottom: 0,
                        width: useStackedLayout ? '100%' : leftWidth,
                        zIndex: 0,
                        pointerEvents: 'none' as const,
                    }}
                />
            )}

            {!ONLY_3D && (
                <MapOL
                    ref={openlayersMapRef}
                    style={olStyle}
                    className={styles['map']}
                />
            )}

            {!singleMapMode && mapViewMode === 'split' && !ONLY_3D && !editRoadviewOffExpand2D && <Divider onMouseDown={handleMouseDown}/>}

            {/* 네이버 파노라마 전용 모드: 네이버 배경+3D면 Cesium 위 전경으로 풀표시. 사용자가 파노라마
                자체를 조작(거리뷰 둘러보기·이동). pointerEvents:auto 로 입력 받음. */}
            {panoActive && (
                <div
                    ref={naverPanoRef}
                    style={{
                        position: 'absolute' as const,
                        top: 0, right: 0, bottom: 0,
                        width: useStackedLayout ? '100%' : rightWidth,
                        zIndex: 5,
                        pointerEvents: 'auto' as const,
                    }}
                />
            )}

            <MapCesium
                ref={cesiumMapRef}
                style={ONLY_3D ? { width: '100%', height: '100%' } : cesiumStyle}
                className={styles['map']}
            />
        </div>
    );
};

export default Maps;