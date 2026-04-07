import { SignalTimelineResponse } from "@stores/useSignalTimelineStore";

export interface TodPlan {
    id: number | string;
    startTime: string;
    endTime: string;
}

export interface TodNode {
    id: string;
    plans: TodPlan[];
}

export interface TodData {
    id?: number;
    nodes?: TodNode[];
}

export interface TodPeriod {
    planId: string;
    simStartSeconds: number;   // 시뮬레이션 시작 기준 상대 초
    durationSeconds: number;
    baseEpochSeconds: number;  // 이 구간의 실제 Unix epoch (초)
}

/** "HH:MM" 또는 "HH:MM:SS" 형식을 자정 기준 초로 변환 */
export function parseWallClockToSeconds(wallClock: string): number {
    if (!wallClock) return 0;
    const parts = wallClock.split(':').map(Number);
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

/**
 * signalTOD 데이터와 시뮬레이션 시간대 정보를 받아,
 * 시뮬레이션 구간 내에서 각 TOD 계획이 활성화되는 구간 목록을 반환합니다.
 *
 * @param todData       useSignalTodStore.currentJsonData (SignalTodXml 형식)
 * @param simWallClockStart  시뮬레이션 실제 시각 시작 문자열 (예: "07:30:00")
 * @param simDurationSeconds 시뮬레이션 총 길이 (초)
 * @param baseEpoch     시뮬레이션 t=0 의 Unix epoch (초)
 */
export function computeTodPeriods(
    todData: TodData,
    simWallClockStart: string,
    simDurationSeconds: number,
    baseEpoch: number
): TodPeriod[] {
    if (!todData?.nodes?.length) return [];

    const simStartSec = parseWallClockToSeconds(simWallClockStart);
    const simEndSec = simStartSec + simDurationSeconds;

    // 전체 노드 중 첫 번째 노드의 plan 목록을 기준으로 전역 TOD 일정을 구성합니다.
    // (노드마다 planId가 다를 수 있으나, 일반적으로 동일한 스케줄을 공유합니다.)
    const firstNode = todData.nodes[0];
    if (!firstNode?.plans?.length) return [];

    const periods: TodPeriod[] = [];

    for (const plan of firstNode.plans) {
        const planStartSec = parseWallClockToSeconds(String(plan.startTime));
        const planEndSec   = parseWallClockToSeconds(String(plan.endTime));

        // 시뮬레이션 구간과 겹치는 부분 계산
        const overlapStart = Math.max(planStartSec, simStartSec);
        const overlapEnd   = Math.min(planEndSec,   simEndSec);

        if (overlapStart >= overlapEnd) continue;

        const simRelativeStart = overlapStart - simStartSec;
        periods.push({
            planId: String(plan.id),
            simStartSeconds: simRelativeStart,
            durationSeconds: overlapEnd - overlapStart,
            baseEpochSeconds: baseEpoch + simRelativeStart,
        });
    }

    return periods.sort((a, b) => a.simStartSeconds - b.simStartSeconds);
}

/**
 * 여러 구간에서 받은 SignalTimelineResponse 배열들을 nodeId 기준으로 병합합니다.
 * 같은 nodeId의 signalTimeline 배열을 시간순으로 이어 붙입니다.
 */
export function mergeSignalTimelines(
    timelineGroups: SignalTimelineResponse[][]
): SignalTimelineResponse[] {
    const byNodeId = new Map<string, SignalTimelineResponse>();

    for (const group of timelineGroups) {
        for (const entry of group) {
            const existing = byNodeId.get(entry.nodeId);
            if (existing) {
                existing.signalTimeline = [
                    ...existing.signalTimeline,
                    ...entry.signalTimeline,
                ];
            } else {
                byNodeId.set(entry.nodeId, {
                    ...entry,
                    signalTimeline: [...entry.signalTimeline],
                    turnInfo: [...(entry.turnInfo ?? [])],
                });
            }
        }
    }

    return Array.from(byNodeId.values());
}
