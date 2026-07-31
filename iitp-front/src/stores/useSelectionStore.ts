import { create } from 'zustand';
import React from "react";

type SelectionGroup = Record<string, (string | React.Key)[]>;

/** 선택이 어디서 발생했는지 — 'grid'(그리드/에디터 단일 행 선택)만 카메라 fly-to/줌을 동반한다.
 *  'map'(지도 클릭)은 하이라이트만 하고 카메라를 움직이지 않는다.
 *  'grid-bulk'(그리드 헤더 전체 체크 / 다중 체크)는 'grid' 와 동일하게 하이라이트만 하고
 *  카메라는 고정한다 — 선택된 guid 마다 fly-to 가 연쇄로 돌면 화면이 대상 사이를 계속
 *  튀어다니며 버벅인다(다중 선택에는 "이동할 단 하나의 목적지"가 없다). */
export type SelectionSource = 'map' | 'grid' | 'grid-bulk';

type SelectionStore = {
    selectedGuid: (string | React.Key)[];
    groupedByType: SelectionGroup;
    selectionSource: SelectionSource;
    /** 편집 그리드를 새로 열 때 "마운트 직후 그리드가 선택·드릴다운할 대상"을 한 번만 전달하는 슬롯.
     *  PropertyPanel 마운트 시 clearSelected() 가 selectedGuid 를 지우므로, 그 클리어에 지워지지 않는
     *  별도 슬롯에 담아 두었다가 PropertyPanel 이 소비(→ setSelectedGuid('grid'))한다. */
    pendingGridGuid: (string | React.Key)[] | null;
    /** 다음 'grid' 선택 1회의 카메라 fly-to 를 건너뛴다. 속성모달 "편집"으로 그리드를 열 때처럼
     *  대상이 이미 화면에 보이는 경우, 리렌더 중 2초 flyToBoundingSphere 가 버벅임만 유발하므로 억제한다.
     *  useDefaultSelect 가 소비 즉시 false 로 되돌린다(일반 그리드 행 선택은 정상적으로 fly). */
    suppressFlyToOnce: boolean;

    setSelectedGuid: (guids: (string | React.Key)[], source?: SelectionSource) => void;
    addSelectionId: (guid: string | React.Key) => void;
    removeSelectionId: (guid: string | React.Key) => void;
    clearSelected: () => void;
    setPendingGridGuid: (guids: (string | React.Key)[] | null) => void;
    setSuppressFlyToOnce: (v: boolean) => void;
};

function getFeatureTypeFromGuid(guid: string | React.Key): string {
    if (typeof guid !== "string") return "unknown";
    const [prefix] = guid.split("-");
    return prefix || "unknown";
}

/** guid 배열 → featureType별 그룹 */
function groupGuidsByType(guids: (string | React.Key)[]): SelectionGroup {
    return guids.reduce((acc, guid) => {
        const type = getFeatureTypeFromGuid(guid);
        if (!acc[type]) acc[type] = [];
        acc[type].push(guid);
        return acc;
    }, {} as SelectionGroup);
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
    selectedGuid: [],
    groupedByType: {},
    selectionSource: 'map',
    pendingGridGuid: null,
    suppressFlyToOnce: false,

    setSelectedGuid: (guids, source = 'map') => {
        set({
            selectedGuid: guids,
            groupedByType: groupGuidsByType(guids),
            selectionSource: source,
        });
    },

    addSelectionId: (guid) => {
        const currentSelected = get().selectedGuid;
        if (!currentSelected.includes(guid)) {
            const newGuids = [...currentSelected, guid];
            set({
                selectedGuid: newGuids,
                groupedByType: groupGuidsByType(newGuids),
            });
        }
    },

    removeSelectionId: (guid) => {
        const currentSelected = get().selectedGuid;
        const newGuids = currentSelected.filter((id) => id !== guid);
        set({
            selectedGuid: newGuids,
            groupedByType: groupGuidsByType(newGuids),
        });
    },

    clearSelected: () => set({
        selectedGuid: [],
        groupedByType: {},
    }),

    setPendingGridGuid: (guids) => set({ pendingGridGuid: guids }),

    setSuppressFlyToOnce: (v) => set({ suppressFlyToOnce: v }),
}));
