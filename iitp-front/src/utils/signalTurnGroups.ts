export interface SignalMovementLike {
    __guid: string;
    turnId?: string | number | null;
    turning?: string | null;
    type?: string | null;
    connectionId?: string | number | null;
    [key: string]: any;
}

export interface NetworkConnectionLike {
    id: string | number;
    fromLink?: string | number;
    toLink?: string | number;
    fromLane?: string | number;
    toLane?: string | number;
    turning?: string;
    [key: string]: any;
}

export interface TurnDirectionSummary {
    key: string;
    label: string;
    icon: string;
    color: string;
    count: number;
}

export interface SignalTurnGroup {
    key: string;
    turnId: string | null;
    signals: SignalMovementLike[];
    connections: NetworkConnectionLike[];
    signalGuids: string[];
    fromLinks: string[];
    directions: TurnDirectionSummary[];
    isRtor: boolean;
    selectable: boolean;
    approachLabel: string;
    directionLabel: string;
    displayLabel: string;
}

export const SIGNAL_DIRECTIONS = [
    { key: "Straight", label: "직진", icon: "↑", color: "#5b96ff" },
    { key: "Left_Turn", label: "좌회전", icon: "↰", color: "#4fc97a" },
    { key: "Right_Turn", label: "우회전", icon: "↱", color: "#f7c44f" },
    { key: "U_Turn", label: "유턴", icon: "↩", color: "#b86cff" },
] as const;

const TURNING_NORMALIZE: Record<string, string> = {
    S: "Straight",
    L: "Left_Turn",
    R: "Right_Turn",
    U: "U_Turn",
};

export function normalizeSignalTurning(value: string | null | undefined): string | null {
    if (!value) return null;
    return TURNING_NORMALIZE[value] ?? value;
}

export function signalDirectionMeta(value: string | null | undefined) {
    const normalized = normalizeSignalTurning(value);
    return SIGNAL_DIRECTIONS.find(direction => direction.key === normalized) ?? {
        key: normalized ?? "",
        label: normalized || "미지정",
        icon: "?",
        color: "#8993a8",
    };
}

function compareTurnIds(left: SignalTurnGroup, right: SignalTurnGroup): number {
    if (left.turnId == null) return 1;
    if (right.turnId == null) return -1;
    const leftNumber = Number(left.turnId);
    const rightNumber = Number(right.turnId);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return left.turnId.localeCompare(right.turnId);
}

/** Signal의 반복 Connection 행을 사용자가 이해할 수 있는 Turn 그룹 요약으로 변환한다. */
export function buildSignalTurnGroups(
    signals: SignalMovementLike[],
    connections: NetworkConnectionLike[],
): SignalTurnGroup[] {
    const connectionById = new Map(
        (connections ?? []).map(connection => [String(connection.id), connection]),
    );
    const grouped = new Map<string, { turnId: string | null; signals: SignalMovementLike[] }>();

    for (const signal of signals ?? []) {
        const hasTurnId = signal.turnId != null && String(signal.turnId).trim() !== "";
        const turnId = hasTurnId ? String(signal.turnId) : null;
        const key = turnId != null ? `turn:${turnId}` : `unassigned:${signal.__guid}`;
        if (!grouped.has(key)) grouped.set(key, { turnId, signals: [] });
        grouped.get(key)!.signals.push(signal);
    }

    return [...grouped.entries()].map(([key, group]): SignalTurnGroup => {
        const matchedConnections = group.signals
            .map(signal => signal.connectionId == null ? undefined : connectionById.get(String(signal.connectionId)))
            .filter((connection): connection is NetworkConnectionLike => !!connection);
        const fromLinks = Array.from(new Set(
            matchedConnections
                .map(connection => connection.fromLink)
                .filter((fromLink): fromLink is string | number => fromLink != null)
                .map(String),
        ));
        const directionCounts = new Map<string, number>();
        for (const signal of group.signals) {
            const direction = normalizeSignalTurning(signal.turning) ?? "Unknown";
            directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);
        }
        const directions = [...directionCounts.entries()]
            .map(([direction, count]) => ({ ...signalDirectionMeta(direction), count }))
            .sort((left, right) => {
                const leftIndex = SIGNAL_DIRECTIONS.findIndex(item => item.key === left.key);
                const rightIndex = SIGNAL_DIRECTIONS.findIndex(item => item.key === right.key);
                return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
            });
        const isRtor = group.signals.length > 0
            && group.signals.every(signal => String(signal.type ?? "").toUpperCase() === "RTOR");
        const approachLabel = fromLinks.length === 1
            ? `진입 링크 #${fromLinks[0]}`
            : fromLinks.length > 1
                ? `진입로 ${fromLinks.length}개`
                : "진입 링크 미확인";
        const directionLabel = directions
            .map(direction => `${direction.icon} ${direction.label} ${direction.count}개`)
            .join(" · ");
        const displayLabel = `${approachLabel} · ${directionLabel || `Connection ${group.signals.length}개`}`;

        return {
            key,
            turnId: group.turnId,
            signals: group.signals,
            connections: matchedConnections,
            signalGuids: group.signals.map(signal => signal.__guid).filter(Boolean),
            fromLinks,
            directions,
            isRtor,
            selectable: group.turnId != null,
            approachLabel,
            directionLabel,
            displayLabel,
        };
    }).sort(compareTurnIds);
}
