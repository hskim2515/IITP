export interface TodPlanLike {
    id: string | number;
    startTime: string;
    endTime: string;
    [key: string]: unknown;
}

export interface TodNodeLike {
    id: string | number;
    plans?: TodPlanLike[];
    [key: string]: unknown;
}

export interface SignalPhaseLike {
    id: string | number;
    duration?: string | number;
    turnList?: string;
    [key: string]: unknown;
}

export interface SignalPlanLike {
    id: string | number;
    cycle?: string | number;
    offset?: string | number;
    phases?: SignalPhaseLike[];
    [key: string]: unknown;
}

export type SignalPlanIssueCode =
    | "invalid-plan-id"
    | "duplicate-plan-id"
    | "invalid-cycle"
    | "invalid-offset"
    | "empty-phases"
    | "invalid-phase-id"
    | "duplicate-phase-id"
    | "invalid-duration"
    | "cycle-mismatch"
    | "unknown-turn";

export interface SignalPlanIssue {
    code: SignalPlanIssueCode;
    planId: string;
    phaseId?: string;
    message: string;
}

export type TodScheduleIssueCode =
    | "empty"
    | "invalid-time"
    | "reversed"
    | "overlap"
    | "gap"
    | "unknown-plan";

export interface TodScheduleIssue {
    code: TodScheduleIssueCode;
    message: string;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** TOD 시각을 분으로 변환한다. 24:00은 종료 시각에서만 허용한다. */
export function parseTodTime(value: string, allow24 = false): number | null {
    const match = String(value ?? "").trim().match(TIME_PATTERN);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] ?? "0");
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null;
    if (minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    if (hour === 24) return allow24 && minute === 0 && second === 0 ? 1440 : null;
    if (hour < 0 || hour > 23) return null;
    return hour * 60 + minute;
}

export function formatTodTime(minutes: number): string {
    const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
    if (clamped === 1440) return "24:00";
    const hour = Math.floor(clamped / 60);
    const minute = clamped % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** signal.xml의 node별 실제 Plan ID 목록을 만든다. */
export function buildSignalPlanIdsByNode(signals: any[]): Map<string, string[]> {
    const idsByNode = new Map<string, Set<string>>();
    for (const signal of signals ?? []) {
        if (signal?.nodeId == null) continue;
        const nodeId = String(signal.nodeId);
        for (const plan of signal?.plans ?? []) {
            if (plan?.id == null) continue;
            if (!idsByNode.has(nodeId)) idsByNode.set(nodeId, new Set());
            idsByNode.get(nodeId)!.add(String(plan.id));
        }
    }
    return new Map(
        [...idsByNode.entries()].map(([nodeId, ids]) => [
            nodeId,
            [...ids].sort((a, b) => {
                const an = Number(a);
                const bn = Number(b);
                return Number.isFinite(an) && Number.isFinite(bn) ? an - bn : a.localeCompare(b);
            }),
        ]),
    );
}

export function validateTodSchedule(
    plans: TodPlanLike[],
    allowedPlanIds: string[],
): TodScheduleIssue[] {
    if (!plans?.length) {
        return [{ code: "empty", message: "시간대 일정이 없습니다." }];
    }

    const issues: TodScheduleIssue[] = [];
    const allowed = new Set(allowedPlanIds.map(String));
    const intervals: Array<{ start: number; end: number; label: string }> = [];

    plans.forEach((plan, index) => {
        const label = `P${plan.id} ${String(plan.startTime).slice(0, 5)}–${String(plan.endTime).slice(0, 5)}`;
        if (!allowed.has(String(plan.id))) {
            issues.push({
                code: "unknown-plan",
                message: `${label}: 신호등에 정의되지 않은 Plan ID입니다.`,
            });
        }

        const start = parseTodTime(plan.startTime, false);
        const end = parseTodTime(plan.endTime, true);
        if (start == null || end == null) {
            issues.push({
                code: "invalid-time",
                message: `${label}: 시각은 HH:mm 형식이어야 하며 종료 시각만 24:00을 사용할 수 있습니다.`,
            });
            return;
        }
        if (end <= start) {
            issues.push({
                code: "reversed",
                message: `${label}: 종료 시각은 시작 시각보다 늦어야 합니다.`,
            });
            return;
        }
        intervals.push({ start, end, label: `${index + 1}번째 구간` });
    });

    if (issues.some(issue => issue.code === "invalid-time" || issue.code === "reversed")) {
        return issues;
    }

    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    let cursor = 0;
    for (const interval of intervals) {
        if (interval.start > cursor) {
            issues.push({
                code: "gap",
                message: `${formatTodTime(cursor)}–${formatTodTime(interval.start)} 시간대가 비어 있습니다.`,
            });
        } else if (interval.start < cursor) {
            issues.push({
                code: "overlap",
                message: `${interval.label}이 이전 시간대와 겹칩니다.`,
            });
        }
        cursor = Math.max(cursor, interval.end);
    }
    if (cursor < 1440) {
        issues.push({
            code: "gap",
            message: `${formatTodTime(cursor)}–24:00 시간대가 비어 있습니다.`,
        });
    }
    return issues;
}

/** 이미 채워진 시간대를 제외한 첫 번째 빈 구간을 반환한다. */
export function findFirstTodGap(
    plans: TodPlanLike[],
): { startTime: string; endTime: string } | null {
    const intervals = (plans ?? [])
        .map(plan => ({
            start: parseTodTime(plan.startTime, false),
            end: parseTodTime(plan.endTime, true),
        }))
        .filter((item): item is { start: number; end: number } =>
            item.start != null && item.end != null && item.end > item.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);

    let cursor = 0;
    for (const interval of intervals) {
        if (interval.start > cursor) {
            return { startTime: formatTodTime(cursor), endTime: formatTodTime(interval.start) };
        }
        cursor = Math.max(cursor, interval.end);
    }
    return cursor < 1440
        ? { startTime: formatTodTime(cursor), endTime: "24:00" }
        : null;
}

/** 삭제 후 추가해도 기존 경로 기반 GUID와 충돌하지 않는 다음 인덱스를 찾는다. */
export function nextIndexedGuid(items: any[], collection: string, parentGuid?: string): string {
    const prefix = parentGuid ? `${parentGuid}.` : "";
    const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\.)${escaped}-(\\d+)$`);
    let maxIndex = -1;
    for (const item of items ?? []) {
        const match = String(item?.__guid ?? "").match(pattern);
        if (match) maxIndex = Math.max(maxIndex, Number(match[1]));
    }
    return `${prefix}${collection}-${maxIndex + 1}`;
}

/** 0부터 시작해 현재 목록에서 사용하지 않은 가장 작은 숫자 ID를 반환한다. */
export function nextNumericId(items: Array<{ id?: string | number }>): string {
    const used = new Set(
        (items ?? [])
            .map(item => Number(item?.id))
            .filter(value => Number.isInteger(value) && value >= 0),
    );
    let candidate = 0;
    while (used.has(candidate)) candidate += 1;
    return String(candidate);
}

/** Signal Plan을 저장하기 전에 NextSim에서 사용하는 기본 정합 조건을 검사한다. */
export function validateSignalPlans(
    plans: SignalPlanLike[],
    allowedTurnIds: string[],
): SignalPlanIssue[] {
    const issues: SignalPlanIssue[] = [];
    const allowedTurns = new Set((allowedTurnIds ?? []).map(String));
    const seenPlanIds = new Set<string>();

    for (const plan of plans ?? []) {
        const planId = String(plan?.id ?? "").trim();
        const numericPlanId = Number(planId);
        if (!planId || !Number.isInteger(numericPlanId) || numericPlanId < 0) {
            issues.push({
                code: "invalid-plan-id",
                planId,
                message: "Plan ID는 0 이상의 정수여야 합니다.",
            });
        } else if (seenPlanIds.has(planId)) {
            issues.push({
                code: "duplicate-plan-id",
                planId,
                message: `P${planId}가 중복되어 있습니다.`,
            });
        }
        seenPlanIds.add(planId);

        const cycle = Number(plan?.cycle);
        if (!Number.isFinite(cycle) || cycle <= 0) {
            issues.push({
                code: "invalid-cycle",
                planId,
                message: `P${planId || "?"}: 주기는 0보다 커야 합니다.`,
            });
        }

        const offset = Number(plan?.offset);
        if (!Number.isFinite(offset) || offset < 0 || (Number.isFinite(cycle) && cycle > 0 && offset >= cycle)) {
            issues.push({
                code: "invalid-offset",
                planId,
                message: `P${planId || "?"}: Offset은 0 이상, 주기보다 작아야 합니다.`,
            });
        }

        const phases = plan?.phases ?? [];
        if (phases.length === 0) {
            issues.push({
                code: "empty-phases",
                planId,
                message: `P${planId || "?"}: 현시가 하나 이상 필요합니다.`,
            });
            continue;
        }

        const seenPhaseIds = new Set<string>();
        let durationTotal = 0;
        let allDurationsValid = true;
        for (const phase of phases) {
            const phaseId = String(phase?.id ?? "").trim();
            const numericPhaseId = Number(phaseId);
            if (!phaseId || !Number.isInteger(numericPhaseId) || numericPhaseId < 0) {
                issues.push({
                    code: "invalid-phase-id",
                    planId,
                    phaseId,
                    message: `P${planId || "?"}: 현시 ID는 0 이상의 정수여야 합니다.`,
                });
            } else if (seenPhaseIds.has(phaseId)) {
                issues.push({
                    code: "duplicate-phase-id",
                    planId,
                    phaseId,
                    message: `P${planId || "?"}: 현시 ${phaseId}가 중복되어 있습니다.`,
                });
            }
            seenPhaseIds.add(phaseId);

            const duration = Number(phase?.duration);
            if (!Number.isFinite(duration) || duration <= 0) {
                allDurationsValid = false;
                issues.push({
                    code: "invalid-duration",
                    planId,
                    phaseId,
                    message: `P${planId || "?"} 현시 ${phaseId || "?"}: 시간은 0보다 커야 합니다.`,
                });
            } else {
                durationTotal += duration;
            }

            const unknownTurns = String(phase?.turnList ?? "")
                .split(/\s+/)
                .filter(Boolean)
                .filter(turnId => !allowedTurns.has(turnId));
            if (unknownTurns.length > 0) {
                issues.push({
                    code: "unknown-turn",
                    planId,
                    phaseId,
                    message: `P${planId || "?"} 현시 ${phaseId || "?"}: 존재하지 않는 Turn ${unknownTurns.join(", ")}을 참조합니다.`,
                });
            }
        }

        if (allDurationsValid && Number.isFinite(cycle) && cycle > 0 && durationTotal !== cycle) {
            issues.push({
                code: "cycle-mismatch",
                planId,
                message: `P${planId || "?"}: 주기 ${cycle}초와 현시 합계 ${durationTotal}초가 다릅니다.`,
            });
        }
    }
    return issues;
}

/** NextSim 실행에 필요한 signal plan node와 TOD의 전체 정합성을 검사한다. */
export function validateTodDataAgainstSignals(signals: any[], todNodes: TodNodeLike[]): string[] {
    const planIdsByNode = buildSignalPlanIdsByNode(signals);
    if (planIdsByNode.size === 0) return [];

    const todByNode = new Map((todNodes ?? []).map(node => [String(node.id), node]));
    const issues: string[] = [];
    for (const [nodeId, planIds] of planIdsByNode) {
        const todNode = todByNode.get(nodeId);
        if (!todNode) {
            issues.push(`교차로 #${nodeId}: 신호 Plan은 있지만 TOD 일정이 없습니다.`);
            continue;
        }
        for (const issue of validateTodSchedule(todNode.plans ?? [], planIds)) {
            issues.push(`교차로 #${nodeId}: ${issue.message}`);
        }
    }
    return issues;
}
