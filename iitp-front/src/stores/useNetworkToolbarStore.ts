import { create } from 'zustand';
import { Coordinates } from '@type/Network';

/**
 * 도로 편집 클릭 지점에 뜨는 맥락 툴바(NetworkEditToolbar) 상태.
 *
 * <p>기존엔 클릭 결과가 화면 우측 고정 패널(NetworkSelectPanel)에 표시돼 클릭 지점과
 * 멀리 떨어져 있었고, 레인/세그먼트/셀은 같은 지점을 반복 클릭해야만 접근 가능해 조작이
 * 불편했다(실사용 피드백). 이 스토어는 그 대신 클릭 지점 근처에 뜨는 작은 버튼바가
 * 무엇을 보여줄지(level)와 어떤 대상(linkId/nodeId/laneIdx/segIdx/cellIdx)을 가리키는지
 * 관리한다 — "차선보기"/"구간보기" 같은 버튼으로 레벨을 전환하며 지도 재클릭 없이도
 * 세부 단계까지 들어갈 수 있다.
 */
export type ToolbarLevel = 'node' | 'link' | 'lane' | 'segment' | 'cell';

type TargetIds = {
    linkId: string | null;
    nodeId: string | null;
    laneIdx: number | null;
    segIdx: number | null;
    cellIdx: number | null;
};

interface NetworkToolbarState extends TargetIds {
    visible: boolean;
    x: number;
    y: number;
    level: ToolbarLevel | null;
    /** 레인 종방향 클릭 위치(0~1) — "차선보기"에서 "구간보기"/"셀보기"로 넘어갈 때 어느
     *  구간/셀을 열지 계산하는 데 쓰인다(재클릭 없이 이미 클릭했던 지점 기준으로 추정).
     *  clickCoord와 함께 "이번 클릭 세션" 메타데이터 — show()에서만 갱신되고 setLevel로
     *  레벨을 오가는 동안에는 유지된다(링크 레벨로 뒤로가도 "여기서 분할" 지점을 잃지 않도록). */
    hitFrac: number | null;
    /** 링크 위 클릭 지점(WGS84) — "여기서 분할" 액션에 필요. */
    clickCoord: Coordinates | null;

    show: (
        pos: { x: number; y: number },
        level: ToolbarLevel,
        ids: Partial<TargetIds>,
        session?: { hitFrac?: number | null; clickCoord?: Coordinates | null },
    ) => void;
    /** 같은 위치·클릭 세션(hitFrac/clickCoord)을 유지한 채 레벨/대상 id만 전환
     *  (뒤로·차선보기·구간보기·셀보기 버튼용). 지정 안 한 id 필드는 null로 리셋된다. */
    setLevel: (level: ToolbarLevel, ids?: Partial<TargetIds>) => void;
    hide: () => void;
}

const emptyTargetIds: TargetIds = {
    linkId: null, nodeId: null, laneIdx: null, segIdx: null, cellIdx: null,
};

export const useNetworkToolbarStore = create<NetworkToolbarState>((set) => ({
    visible: false,
    x: 0,
    y: 0,
    level: null,
    ...emptyTargetIds,
    hitFrac: null,
    clickCoord: null,

    show: (pos, level, ids, session) => set({
        visible: true, x: pos.x, y: pos.y, level,
        ...emptyTargetIds, ...ids,
        hitFrac: session?.hitFrac ?? null,
        clickCoord: session?.clickCoord ?? null,
    }),
    setLevel: (level, ids) => set({ level, ...emptyTargetIds, ...(ids ?? {}) }),
    hide: () => set({ visible: false, level: null, ...emptyTargetIds, hitFrac: null, clickCoord: null }),
}));
