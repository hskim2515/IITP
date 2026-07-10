import { create } from 'zustand';
import { Coordinates } from '@type/Network';

/** 선택 모드 링크 우클릭 컨텍스트 메뉴 (여기서 분할 / 방향 반전 / 삭제) */
interface LinkContextMenuState {
    visible: boolean;
    screenX: number;
    screenY: number;
    linkId: number | string | null;
    /** 우클릭한 지점의 WGS84 좌표 — "여기서 분할" 위치 */
    coord: Coordinates | null;
    show: (x: number, y: number, linkId: number | string, coord: Coordinates) => void;
    hide: () => void;
}

export const useLinkContextMenuStore = create<LinkContextMenuState>((set) => ({
    visible: false,
    screenX: 0,
    screenY: 0,
    linkId: null,
    coord: null,
    show: (x, y, linkId, coord) => set({ visible: true, screenX: x, screenY: y, linkId, coord }),
    hide: () => set({ visible: false, linkId: null, coord: null }),
}));
