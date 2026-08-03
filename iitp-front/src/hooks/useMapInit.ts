import { MutableRefObject, useEffect, useState } from 'react';
import { useCesiumStore, CESIUM_TERRAIN_URL } from "@stores/useCesiumStore";
import * as Cesium from "cesium";
import { Cartesian3, Viewer } from "cesium";
import { useLayerStore } from "@stores/useLayerStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { Map as OLMap, View } from "ol";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import * as olProj from "ol/proj";
import { SmoothDragPan } from "@interactions/SmoothDragPan";

const useMapInit = (openlayersMapRef: MutableRefObject<HTMLDivElement | null>, cesiumMapRef: MutableRefObject<Element | null>) => {

    const setMap = useOpenLayersStore.actions.setMap();
    const setView = useOpenLayersStore.actions.setView();

    const setViewer = useCesiumStore((state) => state.setViewer);
    const setLayerManager = useLayerStore((state) => state.setLayerManager);
    const lodLevels = [1.0, 0.5, 0.2];

    const layerGroups = useLayerSchemaStore.state.groups();

    const setActiveLayerGroupName = useLayerStore.actions.setActiveLayerGroupName()
    const setActiveLayerName = useLayerStore.actions.setActiveLayerName()

    const [lodModels, setLodModels] = useState(null);

    //const lodWorker = new Worker(new URL('/src/workers/lodWorker.ts', import.meta.url), { type: 'module' });

    useEffect(() => {
        if (!cesiumMapRef.current) return;
        if (layerGroups.length === 0) return;
        initializeMaps().then(() => console.log("initializeMaps"));
    }, [layerGroups, cesiumMapRef.current]);

    const initializeMaps = async () => {
        openLayersMapInit();
        await cesiumMapInit();
    };

    useEffect(() => {
        if (layerGroups.length === 0) return;
        setActiveLayerGroupName(['baseMap']);
        const baseMapGroup = layerGroups.find(g => g.key === 'baseMap');
        const defaultLayer = baseMapGroup?.layers?.find(l => l.basic);
        if (defaultLayer) {
            setActiveLayerName([defaultLayer.key]);
        }
    }, [layerGroups])

    const openLayersMapInit = () => {
        if (!openlayersMapRef.current) return;
        // 1) Map & View 초기화
        const view = new View({
            center: olProj.fromLonLat([126.77496, 37.49720]),
            zoom: 16,
        });
        const olMap = new OLMap({
            pixelRatio: 1,
            target: openlayersMapRef.current,
            view,
            interactions: defaultInteractions({ dragPan: false }).extend([new SmoothDragPan()]),
        });
        setMap(olMap);
        setView(view);

        return {olMap}
    }

    const cesiumMapInit = async () => {
        if (!cesiumMapRef.current) return;
        Cesium.Ion.defaultAccessToken = '';  // Set your Cesium Ion access token here
        const cesiumViewer = new Viewer(cesiumMapRef.current, {
            terrain: new Cesium.Terrain(Cesium.CesiumTerrainProvider.fromUrl(CESIUM_TERRAIN_URL, { requestVertexNormals: true })),
            shouldAnimate: true,
            selectionIndicator: false,
            timeline: false,
            animation: false,
            navigationHelpButton: false,
            homeButton: false,
            sceneModePicker: false,
            geocoder: false,
            fullscreenButton: false,
            infoBox: false,
            requestRenderMode: true,
            maximumRenderTimeChange: Infinity,
            baseLayerPicker: false,
            // imageryProvider 미지정 시 Cesium이 자체 기본 배경(Ion World Imagery, asset id 2)을
            // 만드는데, Ion 토큰을 비워뒀으므로(위) 그 요청은 항상 401로 실패한다(콘솔에
            // "api.cesium.com/v1/assets/2/endpoint 401" 로 나타남) — 실제 배경지도는
            // BaseMapLayerManager가 VWorld 타일로 별도 추가하므로 이 기본 레이어는 불필요.
            baseLayer: false,
            creditContainer: document.createElement("div")
            // contextOptions: {
            //     webgl: gl, // ✅ OpenLayers의 WebGL 컨텍스트 재사용
            // },
        });

        // Cesium Viewer 기본 동작 차단: 엔티티 더블클릭 → trackedEntity 설정 → 카메라가
        // 줌인하며 해당 엔티티에 시점이 고정(tracking)되는 내장 핸들러 제거.
        // (selectionIndicator/infoBox=false 는 UI 만 숨길 뿐 이 input action 과는 별개)
        cesiumViewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        // 이미 걸린 tracking 이 있어도 즉시 해제되도록 방어
        cesiumViewer.trackedEntity = undefined;

        // GroundPolylinePrimitive 배치(clampToGround 도로/신호 커넥션) 갱신 중 팬/줌으로 인한
        // 빈번한 엔티티 추가/제거 churn 때 Cesium 내부에서 드물게 예외가 난다(실측:
        // "Cannot read properties of undefined (reading 'id')" @ StaticGroundPolylinePerMaterialBatch).
        //
        // Cesium 소스(startRenderLoop)를 직접 확인한 결과: 렌더 중 예외가 나면
        // useDefaultRenderLoop=false로 내리고 showErrorPanel()을 호출할 뿐, catch 블록에서
        // requestAnimationFrame(render2)를 다시 예약하지 않는다 — 즉 재귀 루프 자체가 끊긴다.
        // showErrorPanel 안에서 useDefaultRenderLoop를 다시 true로 되돌려도 아무도 다음
        // requestAnimationFrame을 걸어주지 않으므로 영영 재개되지 않는다(실측: 효과 없었음).
        // 그래서 Cesium의 기본 루프를 끄고 우리가 직접 매 프레임 try/catch로 감싸 구동한다 —
        // 이번 프레임이 실패해도 반드시 다음 프레임을 스스로 다시 예약해 자기유지시킨다.
        cesiumViewer.useDefaultRenderLoop = false;

        // 위 커스텀 루프만으로는 부족하다: CesiumWidget.render()는 내부적으로
        // Clock.tick() → _onTick → dataSourceDisplay.update() 를 먼저 실행한 "다음에"
        // scene.render()(실제 프리미티브 업데이트·드로우, 차량 위치 반영 포함)를 호출한다.
        // dataSourceDisplay.update() 안에서 예외가 나면 CesiumWidget.render() 전체가 그
        // 지점에서 중단되어 scene.render()가 아예 실행되지 않는다 — 도로/신호 등 다른 건
        // 문제없는데 유독 "차량만" 안 움직이고 사라져 보이던 이유(차량 위치 갱신이
        // scene.render() 경로에 걸려 있음). dataSourceDisplay.update() 자체를 감싸서 그
        // 배치 오류만 흡수하면, scene.render()는 매 프레임 정상적으로 계속 실행된다.
        const originalDataSourceDisplayUpdate = cesiumViewer.dataSourceDisplay.update.bind(cesiumViewer.dataSourceDisplay);
        (cesiumViewer.dataSourceDisplay as any).update = (time: any) => {
            try {
                return originalDataSourceDisplayUpdate(time);
            } catch (error) {
                console.error('[Cesium] dataSourceDisplay.update 오류 — 이번 프레임만 건너뜀:', error);
                return true;
            }
        };

        let cesiumRenderLoopStopped = false;
        const runCesiumRenderLoop = () => {
            if (cesiumRenderLoopStopped || cesiumViewer.isDestroyed()) return;
            try {
                cesiumViewer.resize();
                cesiumViewer.render();
            } catch (error) {
                console.error('[Cesium] 프레임 렌더 오류 — 다음 프레임에서 계속 진행:', error);
            }
            requestAnimationFrame(runCesiumRenderLoop);
        };
        requestAnimationFrame(runCesiumRenderLoop);

        cesiumViewer.camera.setView({
            destination: Cartesian3.fromDegrees(126.77496, 37.49720, 10000) // Adjust the height as needed
        });

        cesiumViewer.scene.debugShowFramesPerSecond = true;

        cesiumViewer.cesiumWidget.creditDisplay.container.style.display = "none";

        // 지형 LOD: 기본(2)은 매우 정밀 → 줌아웃 시 넓은 영역을 고해상도 메시로 그려 부하 폭증.
        //   단 16까지 올리면 배경 이미지리가 2D 대비 ~3레벨 낮게 그려져 "3D만 흐릿"해짐
        //   (SSE 2배 ≈ 타일 1레벨 코스). 4 = 2D 대비 ~1레벨 코스로 체감 선명도 유지 + 기본 대비 부하 절감.
        cesiumViewer.scene.globe.maximumScreenSpaceError = 4;
        cesiumViewer.scene.globe.depthTestAgainstTerrain = true;
        cesiumViewer.scene.useDepthPicking = true

        cesiumViewer.scene.backgroundColor = Cesium.Color.BLACK;
        cesiumViewer.scene.skyAtmosphere.show = false;
        cesiumViewer.scene.skyBox.show = false;
        cesiumViewer.scene.globe.baseColor = Cesium.Color.DARKGRAY;
        cesiumViewer.scene.globe.enableLighting = false;

        // ── 렌더 경량화: 매 프레임 안티앨리어싱/안개 패스 비용 절감 (이 스케일에선 화질 영향 미미) ──
        cesiumViewer.scene.msaaSamples = 1;                       // MSAA 비활성 (기본 4 → 1): 풀스크린 멀티샘플 패스 제거
        if (cesiumViewer.scene.postProcessStages.fxaa) {
            cesiumViewer.scene.postProcessStages.fxaa.enabled = false; // FXAA 포스트프로세스 패스 제거
        }
        cesiumViewer.scene.fog.enabled = false;                   // 거리 안개 계산 제거

        // cesiumViewer.scene.light = new Cesium.DirectionalLight({
        //     direction: new Cesium.Cartesian3(0.0, 0.0, 0.0) // 빛 없음
        // });

        setViewer(cesiumViewer);
        // dev 전용: E2E 테스트(Playwright)에서 카메라 제어/상태 검사용 노출
        if (import.meta.env.DEV) (window as any).__cesiumViewer = cesiumViewer;

        fetch("CesiumMilkTruck.glb")
            .then(res => res.arrayBuffer())
            .then(glbBuffer => {
                // lodWorker.postMessage({ glbBuffer, lodLevels });
                //
                // lodWorker.onmessage = (event) => {
                //     if (event.data.success) {
                //         console.log('LOD 생성 완료:', event.data.lodBuffers);
                //         setLodModels(event.data.lodBuffers)
                //     } else {
                //         console.error('LOD 생성 실패:', event.data.error);
                //     }
                // };
            });

        try {

            // const tileSet1 = await Cesium.Cesium3DTileset.fromUrl(
            //     "https://cdn.vworld.kr/TDServer/services/map4/TG9ENA/Daejeon/Daejeon/$S_1_7_from_tileset.json",
            //     //"http://192.168.10.182/ngii-buildings/3DTiles_mouna/gyunggi/tileset.json",
            //     //"https://175.197.92.213:10203/three-d-tiles/griw_back/tileset.json",
            // );
            // const tileSet2 = await Cesium.Cesium3DTileset.fromUrl("https://cdn.vworld.kr/TDServer/services/map4/TG9ENA/Daejeon/Daejeon/$S_2_4_from_tileset.json")
            // const tileSet3 = await Cesium.Cesium3DTileset.fromUrl("https://cdn.vworld.kr/TDServer/services/map4/TG9ENA/Daejeon/Daejeon-bridge/tileset.json")
            // cesiumViewer.scene.primitives.add(tileSet1)
            // cesiumViewer.scene.primitives.add(tileSet2)
            // cesiumViewer.scene.primitives.add(tileSet3)
        } catch (error) {
            console.log(`Error loading tileset: ${error}`);
        }

        return {
            cesiumViewer
        }
    }
};

export default useMapInit;