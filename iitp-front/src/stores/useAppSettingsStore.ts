import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BaseMapType } from '@stores/useMapStore';

/** 더미 신호 자동생성(signal.ts의 generateDummySignals, "화면 내 더미 신호 생성" 버튼) /
 *  OD 매트릭스 자동생성(iitp-rest NextSimInputScaffolder.buildSampleOdMatrix, KTDB 임포트 시
 *  서버가 자동 생성) 파라미터. 도로/도시 형태가 지역마다 달라 고정값 하나로는 안 맞는 경우가
 *  있어 사용자가 조정할 수 있게 노출.
 *  signalOppositeBearingToleranceDeg는 자동생성뿐 아니라 수동 편집 상충 검사
 *  (checkManualSignalEditConflicts)에도 같은 값이 쓰인다 — "마주보는 접근로" 판정 기준을
 *  자동생성/수동편집 양쪽에서 일치시키기 위함.
 *  odMinFlow/odMaxFlow/odRefDistM은 프론트에서 값만 들고 있다가 KTDB 임포트 요청(FileImportModal)
 *  에 실어 보내면 백엔드가 실제 계산에 쓴다 — 이 스토어 자체는 백엔드에서 읽지 않는다. */
export interface AutoGenerationSettings {
    /** 더미 신호 현시(phase) 1개당 길이 (초) */
    signalPhaseDurationSec: number;
    /** 두 접근로 방위각差가 180±이 값(도) 이내면 "마주보는 방향"(동시 녹색 안전)으로 판정 */
    signalOppositeBearingToleranceDeg: number;
    /** OD 샘플 수요 최소 flow (대/h) — 거리 감쇠로 가장 먼 source-sink 쌍에 부여되는 값 */
    odMinFlow: number;
    /** OD 샘플 수요 최대 flow (대/h) — 거리 감쇠로 가장 가까운 source-sink 쌍에 부여되는 값 */
    odMaxFlow: number;
    /** OD 거리 감쇠 기준 거리 (m) — 이보다 가까우면 odMaxFlow 근접, 멀수록 odMinFlow로 수렴 */
    odRefDistM: number;
    /** 네트워크 임포트/온보딩 완료 시 더미 노면표시를 자동 생성할지 (dummyGeneration.ts) */
    pavementMarkingEnabled: boolean;
    /** KTDB 임포트 시 OSM 버스정류장/노선을 자동 생성할지 (OsmFacilityConverter, 백엔드) */
    busFacilityEnabled: boolean;
    /** KTDB 임포트 시 OSM 철도역/노선을 자동 생성할지 (OsmFacilityConverter, 백엔드) */
    railFacilityEnabled: boolean;
    /** OSM에 배차간격 정보가 없어 변환된 버스 노선에 일괄로 채우는 기본값 (분) */
    busDefaultIntervalMin: number;
}

export const DEFAULT_AUTO_GENERATION_SETTINGS: AutoGenerationSettings = {
    signalPhaseDurationSec: 30,
    signalOppositeBearingToleranceDeg: 30,
    odMinFlow: 5,
    odMaxFlow: 60,
    odRefDistM: 300,
    pavementMarkingEnabled: true,
    busFacilityEnabled: true,
    railFacilityEnabled: true,
    busDefaultIntervalMin: 10,
};

/**
 * 브라우저에 영속되는(localStorage) 사용자 앱 설정 — 시나리오/버전과 무관하게 이 브라우저에서
 * 항상 유지되는 개인 취향 설정. 시나리오별 값(예: 네트워크 타일 모드)은 useNetworkTileStore처럼
 * 별도 스토어를 쓴다.
 */
interface AppSettingsState {
    /** 세션 시작 시 적용할 배경지도 기본값. null이면 서버 레이어 스키마의 basic 필드를 그대로 사용
     *  (BaseMap.tsx가 폴백 처리). */
    defaultBaseMap: BaseMapType | null;
    setDefaultBaseMap: (v: BaseMapType | null) => void;

    autoGeneration: AutoGenerationSettings;
    setAutoGeneration: (partial: Partial<AutoGenerationSettings>) => void;
    resetAutoGeneration: () => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
    persist(
        (set) => ({
            defaultBaseMap: null,
            setDefaultBaseMap: (v) => set({ defaultBaseMap: v }),

            autoGeneration: DEFAULT_AUTO_GENERATION_SETTINGS,
            setAutoGeneration: (partial) =>
                set((s) => ({ autoGeneration: { ...s.autoGeneration, ...partial } })),
            resetAutoGeneration: () => set({ autoGeneration: DEFAULT_AUTO_GENERATION_SETTINGS }),
        }),
        {
            name: 'app-settings',
            // persist는 기본적으로 최상위 키만 얕게 병합한다 — autoGeneration처럼 스토어 진화
            // 중간에 필드가 늘어난 중첩 객체는 예전 localStorage 값이 그대로 통째로 덮어써
            // 새 필드(odMinFlow 등)가 undefined가 될 수 있어, autoGeneration만 기본값과 깊이 병합.
            merge: (persisted, current) => {
                const p = (persisted ?? {}) as Partial<AppSettingsState>;
                return {
                    ...current,
                    ...p,
                    autoGeneration: { ...current.autoGeneration, ...p.autoGeneration },
                };
            },
        },
    ),
);
