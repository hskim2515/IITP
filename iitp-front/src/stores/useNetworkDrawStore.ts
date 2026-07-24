import { create } from 'zustand';
import { Coordinates } from '@type/Network';

export type PlacementMode = 'none' | 'busStation' | 'railStation' | 'signal';

interface NetworkDrawState {
    isActive: boolean;
    isConnectionActive: boolean;
    isSelectActive: boolean;
    placementMode: PlacementMode;
    laneCount: number;
    linkWidth: number;
    maxSpd: number;
    isBidirectional: boolean;
    // 현재 그리기 시작점 (스냅된 노드 ID 또는 null)
    startNodeId: number | string | null;
    startNodeCoord: Coordinates | null;
    // 교차로 편집 모드: 선택된 노드 ID
    connSelectedNodeId: number | string | null;
    // 교차로로 지정된 노드 (id → 좌표). 거리 기반 자동 병합은 하지 않는다(조밀한 도심에서
    // 서로 다른 두 교차로가 잘못 합쳐질 위험이 있어 폐기) — 순전히 "넓은 스냅 반경 + 항상
    // 보이는 마커"용 힌트일 뿐이라, 실제 연결은 findSnapNode가 이 좌표 근처에서 그 정확한
    // id의 노드를 스냅 대상으로 찾아줘야만 이루어진다(항상 같은 노드에만 연결 — 오판 병합
    // 불가). 좌표를 별도로 들고 있는 이유: 타일 evict로 해당 노드가 currentJsonData 에서
    // 빠져도 마커는 계속 표시해 사용자가 "여기로 다시 스냅해야 한다"를 알 수 있게 하기 위함.
    intersectionNodes: Record<string, Coordinates>;
    // 그리기 리셋 트리거: 이 값이 바뀌면 draw effect가 재실행되어 refs 초기화
    drawResetKey: number;
    // 교차로 지정 후 draw effect가 시작점을 자동 설정할 노드 ID
    pendingStartNodeId: string | null;
    // 빈 지형 클릭으로 그리기를 시작할 때 draw effect가 시작점으로 쓸 좌표(스냅 노드 없음).
    // pendingStartNodeId와 동일한 소비 패턴 — effect 마운트 시 한 번 읽고 비운다.
    pendingStartCoord: Coordinates | null;
    // 노드 선택 맥락 툴바의 "커넥션 편집" 버튼으로 진입할 때, connection effect가 마운트 시
    // 바로 이 노드의 phase='edit'로 점프하기 위해 읽는 값 — 소비 후 비운다.
    pendingConnNodeId: number | string | null;
    // 마지막으로 그린 구간의 끝점(체인 끝) — "그리기 중지" 후 화면 밖으로 팬했다가 다시
    // "그리기 시작"을 누르면 이 지점에서 자동으로 이어 그리기를 재개한다(타일 그리기 모드는
    // isActive 중 팬이 동결되므로, 넓은 지역을 이어 그릴 땐 중지→팬→재시작이 불가피한데
    // 매번 새 시작점을 다시 클릭해야 하는 불편을 없앤다). 이어 그리기를 명시적으로
    // 끝내면(더블클릭) 초기화된다.
    chainEndpoint: { nodeId: string; coord: Coordinates } | null;
    // 선택 모드: 단일 선택 (편집 핸들용)
    selectedLinkId: number | string | null;
    selectedNodeId: number | string | null;
    selectedLaneId: string | null;  // `${linkId}_${laneIdx}` — 개별 레인 선택
    selectedSegmentId: string | null;  // `${linkId}_${laneIdx}_${segIdx}` — 개별 세그먼트 선택(모두 배열 인덱스 기준)
    // 멀티셀렉트 (Shift+클릭, 박스 드래그)
    selectedLinkIds: string[];
    selectedNodeIds: string[];
    // 방금 클릭해 확정한 그리기 점(도로 그리기 중 노드/구간점). 편집모드 로드뷰가 지도 중심이
    // 아니라 "지금 그리고 있는 지점"을 바로 따라가도록 useNaverPanorama가 구독한다.
    lastDrawnPoint: Coordinates | null;

    setActive: (active: boolean) => void;
    setConnectionActive: (active: boolean) => void;
    setSelectActive: (active: boolean) => void;
    setPlacementMode: (mode: PlacementMode) => void;
    setLaneCount: (count: number) => void;
    setLinkWidth: (width: number) => void;
    setMaxSpd: (spd: number) => void;
    setBidirectional: (v: boolean) => void;
    setStartNode: (id: number | string | null, coord: Coordinates | null) => void;
    setConnSelectedNodeId: (id: number | string | null) => void;
    addIntersectionNode: (id: number | string, coord: Coordinates) => void;
    removeIntersectionNode: (id: number | string) => void;
    activateAndReset: (startNodeId?: string) => void;
    /** 빈 지형 클릭 좌표에서 그리기 시작(재클릭 불필요) — activateAndReset의 좌표 버전. */
    beginDrawAt: (coord: Coordinates) => void;
    /** 노드 선택 툴바의 "커넥션 편집" 버튼 — 그 노드로 바로 진입한 채 커넥션 편집 모드 시작. */
    activateConnectionAndReset: (nodeId: number | string) => void;
    clearPendingStart: () => void;
    clearPendingConnNode: () => void;
    /** 그리기/커넥션 편집을 끝내고 선택 모드로 되돌아간다 — setActive(false)/setConnectionActive(false)
     *  단독 호출은 아무 모드로도 안 돌아가 사용자가 다시 손 갈 데를 잃으므로, "이 조작을 끝냈다"는
     *  모든 종료 지점(ESC, 우클릭 취소 등)은 항상 이 함수를 대신 써야 한다. */
    exitToSelect: () => void;
    setChainEndpoint: (nodeId: string | number, coord: Coordinates) => void;
    clearChainEndpoint: () => void;
    /** diff 저장 후 서버가 재채번한 id(nodeIdRemap/odNodeIdRemap/linkIdRemap)를 이 스토어가
     *  들고 있는 모든 id 참조에 반영한다 — 그리기 중 붙인 프론트 임시 id(Date.now())가
     *  저장 시점에 실제 규칙 id로 바뀔 수 있는데, 이걸 안 하면 "교차로 지정"/이어 그리기
     *  재개/선택 상태가 저장 후 조용히 무효화된다. */
    remapStaleIds: (nodeRemap: Record<string, string>, linkRemap: Record<string, string>) => void;
    setSelectedLink: (id: number | string | null) => void;
    setSelectedNode: (id: number | string | null) => void;
    setSelectedLane: (id: string | null) => void;
    setSelectedSegment: (id: string | null) => void;
    clearSelection: () => void;
    toggleSelectedLinkId: (id: string) => void;
    toggleSelectedNodeId: (id: string) => void;
    setSelectedLinkIds: (ids: string[]) => void;
    setSelectedNodeIds: (ids: string[]) => void;
    clearMultiSelection: () => void;
    setLastDrawnPoint: (point: Coordinates | null) => void;
    reset: () => void;
}

export const useNetworkDrawStore = create<NetworkDrawState>((set) => ({
    isActive: false,
    isConnectionActive: false,
    isSelectActive: false,
    placementMode: 'none' as PlacementMode,
    laneCount: 2,
    linkWidth: 7.0,
    maxSpd: 50,
    isBidirectional: false,
    startNodeId: null,
    startNodeCoord: null,
    connSelectedNodeId: null,
    intersectionNodes: {},
    drawResetKey: 0,
    pendingStartNodeId: null,
    pendingStartCoord: null,
    pendingConnNodeId: null,
    chainEndpoint: null,
    selectedLinkId: null,
    selectedNodeId: null,
    selectedLaneId: null,
    selectedSegmentId: null,
    selectedLinkIds: [],
    selectedNodeIds: [],
    lastDrawnPoint: null,

    setActive: (active) => set({ isActive: active, isConnectionActive: false, isSelectActive: false, placementMode: 'none' }),
    setConnectionActive: (active) => set({ isConnectionActive: active, isActive: false, isSelectActive: false, connSelectedNodeId: null, placementMode: 'none' }),
    setSelectActive: (active) => set({ isSelectActive: active, isActive: false, isConnectionActive: false, selectedLinkId: null, selectedNodeId: null, selectedLaneId: null, selectedSegmentId: null, placementMode: 'none' }),
    setPlacementMode: (mode) => set({ placementMode: mode, isActive: false, isConnectionActive: false, isSelectActive: false }),
    setLaneCount: (count) => set({ laneCount: count }),
    setLinkWidth: (width) => set({ linkWidth: width }),
    setMaxSpd: (spd) => set({ maxSpd: spd }),
    setBidirectional: (v) => set({ isBidirectional: v }),
    setStartNode: (id, coord) => set({ startNodeId: id, startNodeCoord: coord }),
    setConnSelectedNodeId: (id) => set({ connSelectedNodeId: id }),
    addIntersectionNode: (id, coord) => set((s) => ({
        intersectionNodes: { ...s.intersectionNodes, [String(id)]: coord },
    })),
    removeIntersectionNode: (id) => set((s) => {
        const next = { ...s.intersectionNodes };
        delete next[String(id)];
        return { intersectionNodes: next };
    }),
    activateAndReset: (startNodeId?) => set((s) => ({
        isActive: true,
        isConnectionActive: false,
        isSelectActive: false,
        placementMode: 'none',
        drawResetKey: s.drawResetKey + 1,
        pendingStartNodeId: startNodeId ?? null,
        pendingStartCoord: null,
        // 매번 새로 그리기를 시작할 때 단방향으로 리셋 — 실제 도로 대부분은 단방향이라
        // 기본값이어야 하고, 체크박스는 세션 내내 상태가 남아있어(zustand, 새로고침 전까지
        // 유지) 이전에 양방향으로 그렸으면 그다음 새 도로도 계속 양방향으로 그려지는
        // 문제가 있었다. 이어 그리기(체인 continue)는 activateAndReset을 다시 호출하지
        // 않으므로 영향받지 않는다.
        isBidirectional: false,
    })),
    beginDrawAt: (coord) => set((s) => ({
        isActive: true,
        isConnectionActive: false,
        isSelectActive: false,
        placementMode: 'none',
        drawResetKey: s.drawResetKey + 1,
        pendingStartNodeId: null,
        pendingStartCoord: coord,
        isBidirectional: false,
    })),
    activateConnectionAndReset: (nodeId) => set({
        isConnectionActive: true,
        isActive: false,
        isSelectActive: false,
        placementMode: 'none',
        connSelectedNodeId: null,
        pendingConnNodeId: nodeId,
    }),
    exitToSelect: () => set({
        isActive: false, isConnectionActive: false, placementMode: 'none', isSelectActive: true,
        pendingStartNodeId: null, pendingStartCoord: null, pendingConnNodeId: null,
    }),
    clearPendingStart: () => set({ pendingStartNodeId: null, pendingStartCoord: null }),
    clearPendingConnNode: () => set({ pendingConnNodeId: null }),
    setChainEndpoint: (nodeId, coord) => set({ chainEndpoint: { nodeId: String(nodeId), coord } }),
    clearChainEndpoint: () => set({ chainEndpoint: null }),
    remapStaleIds: (nodeRemap, linkRemap) => set((s) => {
        const rmNode = (id: string) => nodeRemap[id] ?? id;
        const rmNodeOrNull = (id: number | string | null) => id == null ? id : (nodeRemap[String(id)] ?? id);
        const rmLinkOrNull = (id: number | string | null) => id == null ? id : (linkRemap[String(id)] ?? id);
        const remappedIntersectionNodes: Record<string, Coordinates> = {};
        for (const [oldId, coord] of Object.entries(s.intersectionNodes)) {
            remappedIntersectionNodes[rmNode(oldId)] = coord;
        }
        return {
            intersectionNodes: remappedIntersectionNodes,
            chainEndpoint: s.chainEndpoint
                ? { ...s.chainEndpoint, nodeId: rmNode(s.chainEndpoint.nodeId) }
                : s.chainEndpoint,
            pendingStartNodeId: s.pendingStartNodeId != null ? rmNode(s.pendingStartNodeId) : s.pendingStartNodeId,
            startNodeId: rmNodeOrNull(s.startNodeId),
            connSelectedNodeId: rmNodeOrNull(s.connSelectedNodeId),
            selectedNodeId: rmNodeOrNull(s.selectedNodeId),
            selectedNodeIds: s.selectedNodeIds.map(rmNode),
            selectedLinkId: rmLinkOrNull(s.selectedLinkId),
            selectedLinkIds: s.selectedLinkIds.map(id => linkRemap[id] ?? id),
            // 세그먼트 선택 키(linkId_laneIdx_segIdx)는 laneIdx/segIdx까지 재매핑할 방법이
            // 없어(서버가 레인/세그먼트 순서를 보존한다는 보장이 없음) 안전하게 선택 해제.
            selectedSegmentId: null,
            pendingConnNodeId: rmNodeOrNull(s.pendingConnNodeId),
        };
    }),
    setSelectedLink: (id) => set({ selectedLinkId: id, selectedNodeId: null, selectedLaneId: null, selectedSegmentId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    setSelectedNode: (id) => set({ selectedNodeId: id, selectedLinkId: null, selectedLaneId: null, selectedSegmentId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    setSelectedLane: (id) => set({ selectedLaneId: id, selectedLinkId: null, selectedNodeId: null, selectedSegmentId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    setSelectedSegment: (id) => set({ selectedSegmentId: id, selectedLinkId: null, selectedNodeId: null, selectedLaneId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    clearSelection: () => set({ selectedLinkId: null, selectedNodeId: null, selectedLaneId: null, selectedSegmentId: null, selectedLinkIds: [], selectedNodeIds: [] }),
    toggleSelectedLinkId: (id) => set(s => ({
        selectedLinkId: null, selectedNodeId: null,
        selectedLinkIds: s.selectedLinkIds.includes(id)
            ? s.selectedLinkIds.filter(x => x !== id)
            : [...s.selectedLinkIds, id],
        selectedNodeIds: [],
    })),
    toggleSelectedNodeId: (id) => set(s => ({
        selectedLinkId: null, selectedNodeId: null,
        selectedNodeIds: s.selectedNodeIds.includes(id)
            ? s.selectedNodeIds.filter(x => x !== id)
            : [...s.selectedNodeIds, id],
        selectedLinkIds: [],
    })),
    setSelectedLinkIds: (ids) => set({ selectedLinkIds: ids, selectedNodeIds: [], selectedLinkId: null, selectedNodeId: null }),
    setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids, selectedLinkIds: [], selectedLinkId: null, selectedNodeId: null }),
    clearMultiSelection: () => set({ selectedLinkIds: [], selectedNodeIds: [] }),
    setLastDrawnPoint: (point) => set({ lastDrawnPoint: point }),
    reset: () => set({ isActive: false, isConnectionActive: false, isSelectActive: false, placementMode: 'none', startNodeId: null, startNodeCoord: null, connSelectedNodeId: null, pendingStartCoord: null, pendingConnNodeId: null, pendingStartNodeId: null, selectedLinkId: null, selectedNodeId: null, selectedLaneId: null, selectedSegmentId: null, selectedLinkIds: [], selectedNodeIds: [], chainEndpoint: null }),
}));
