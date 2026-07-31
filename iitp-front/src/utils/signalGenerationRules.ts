import type { SignalPlan } from "@type/Signal";
import { normalizeTurning } from "@utils/turning";

export interface SignalConnectionInput {
    id: string | number;
    fromLink?: string | number | null;
    turning?: string | null;
}

export interface GeneratedSignalTurn {
    id: string;
    fromLink: string;
    turning: string | null;
    type: "RTOR" | "None";
    connectionIds: string[];
}

export interface SignalTurnGenerationResult {
    turns: GeneratedSignalTurn[];
    turnIdByConnectionId: Map<string, string>;
    regularApproachIds: string[];
}

export interface SignalPlanGenerationOptions {
    nodeId: string | number;
    phaseApproachGroups: string[][];
    turns: GeneratedSignalTurn[];
    offPeakGreenSeconds?: number;
    peakGreenSeconds?: number;
    transitionSeconds?: number;
    minGreenSeconds?: number;
}

export interface GeneratedSignalTodPlan {
    id: string | number;
    startTime: string;
    endTime: string;
}

/**
 * 1. Connection → Turn
 *
 * Turn의 기준은 "진입 링크(fromLink) + 회전 방향(turning)"이며, 일반 이동류를 먼저
 * 채번하고 RTOR 이동류를 뒤에 채번한다. Connection ID는 노드 내부 로컬 ID를 그대로 쓴다.
 */
export function generateSignalTurns(
    connections: SignalConnectionInput[],
): SignalTurnGenerationResult {
    const approachOrder: string[] = [];
    const connectionsByApproach = new Map<string, SignalConnectionInput[]>();
    const movementOrder: Array<{ key: string; fromLink: string; turning: string | null }> = [];
    const connectionIdsByMovement = new Map<string, string[]>();
    const regularApproachIds: string[] = [];

    for (const connection of connections ?? []) {
        const fromLink = String(connection.fromLink ?? "default");
        if (!connectionsByApproach.has(fromLink)) {
            approachOrder.push(fromLink);
            connectionsByApproach.set(fromLink, []);
        }
        connectionsByApproach.get(fromLink)!.push(connection);
    }

    // 기존 자동생성의 채번 호환성: fromLink 최초 등장 순서대로 접근로를 순회하고,
    // 각 접근로 안에서 turning 최초 등장 순서대로 movement를 만든다.
    for (const fromLink of approachOrder) {
        const approachConnections = connectionsByApproach.get(fromLink) ?? [];
        if (approachConnections.some(connection => normalizeTurning(connection.turning) !== "Right_Turn")) {
            regularApproachIds.push(fromLink);
        }
        for (const connection of approachConnections) {
            const turning = normalizeTurning(connection.turning);
            const key = `${fromLink}\u0000${turning ?? "Unknown"}`;
            if (!connectionIdsByMovement.has(key)) {
                movementOrder.push({ key, fromLink, turning });
                connectionIdsByMovement.set(key, []);
            }
            connectionIdsByMovement.get(key)!.push(String(connection.id));
        }
    }

    const regularMovements = movementOrder.filter(movement => movement.turning !== "Right_Turn");
    const rtorMovements = movementOrder.filter(movement => movement.turning === "Right_Turn");
    const orderedMovements = [...regularMovements, ...rtorMovements];

    const turns = orderedMovements.map((movement, index): GeneratedSignalTurn => ({
        id: String(index),
        fromLink: movement.fromLink,
        turning: movement.turning,
        type: movement.turning === "Right_Turn" ? "RTOR" : "None",
        connectionIds: connectionIdsByMovement.get(movement.key) ?? [],
    }));

    const turnIdByConnectionId = new Map<string, string>();
    for (const turn of turns) {
        for (const connectionId of turn.connectionIds) {
            turnIdByConnectionId.set(connectionId, turn.id);
        }
    }

    return { turns, turnIdByConnectionId, regularApproachIds };
}

function buildPlan(
    planId: string,
    greenSeconds: number,
    options: {
        nodeId: string | number;
        phaseApproachGroups: string[][];
        turns: GeneratedSignalTurn[];
        transitionSeconds: number;
        minGreenSeconds: number;
    },
): SignalPlan {
    const rtorTurnIds = options.turns
        .filter(turn => turn.type === "RTOR")
        .map(turn => turn.id);

    const phases = options.phaseApproachGroups.flatMap((approaches, index) => {
        const regularTurnIds = options.turns
            .filter(turn => turn.type !== "RTOR" && approaches.includes(turn.fromLink))
            .map(turn => turn.id);

        return [
            {
                id: String(index * 2),
                duration: String(greenSeconds),
                turnList: [...regularTurnIds, ...rtorTurnIds].join(" "),
                minGreenTime: String(options.minGreenSeconds),
                maxGreenTime: String(greenSeconds),
            },
            {
                id: String(index * 2 + 1),
                duration: String(options.transitionSeconds),
                turnList: rtorTurnIds.join(" "),
            },
        ];
    });

    const cycle = phases.reduce((sum, phase) => sum + Number(phase.duration), 0);
    const numericNodeId = Number(options.nodeId);
    const offset = Number.isFinite(numericNodeId) && cycle > 0
        ? Math.abs(Math.trunc(numericNodeId)) % cycle
        : 0;

    return {
        id: planId,
        cycle: String(cycle),
        offset: String(offset),
        phases,
    };
}

/**
 * 2. Turn → Phase/Plan
 *
 * P0은 평시 20초, P1은 혼잡 30초이며 각 녹색 현시 뒤에 RTOR만 포함한
 * 3초 전환 현시를 둔다. Cycle은 현시 시간 합계, Offset은 nodeId % Cycle이다.
 */
export function generateDefaultSignalPlans(options: SignalPlanGenerationOptions): SignalPlan[] {
    const shared = {
        nodeId: options.nodeId,
        phaseApproachGroups: options.phaseApproachGroups,
        turns: options.turns,
        transitionSeconds: options.transitionSeconds ?? 3,
        minGreenSeconds: options.minGreenSeconds ?? 15,
    };

    return [
        buildPlan("0", options.offPeakGreenSeconds ?? 20, shared),
        buildPlan("1", options.peakGreenSeconds ?? 30, shared),
    ];
}

function comparePlanIds(left: string, right: string): number {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
}

/**
 * 3. Plan → TOD
 *
 * P0/P1이 있으면 출퇴근 시간에 P1을 사용하고, 그 외에는 첫 PLAN을 24시간 적용한다.
 */
export function generateDefaultSignalTod(
    planIds: Array<string | number>,
): GeneratedSignalTodPlan[] {
    const definedPlanIds = Array.from(new Set(
        (planIds ?? []).map(String).filter(Boolean),
    )).sort(comparePlanIds);

    if (definedPlanIds.length === 0) return [];
    if (definedPlanIds.includes("0") && definedPlanIds.includes("1")) {
        return [
            { id: 0, startTime: "00:00:00", endTime: "07:00:00" },
            { id: 1, startTime: "07:00:00", endTime: "09:00:00" },
            { id: 0, startTime: "09:00:00", endTime: "17:00:00" },
            { id: 1, startTime: "17:00:00", endTime: "19:00:00" },
            { id: 0, startTime: "19:00:00", endTime: "24:00:00" },
        ];
    }

    const firstPlanId = definedPlanIds[0]!;
    return [{
        id: Number.isFinite(Number(firstPlanId)) ? Number(firstPlanId) : firstPlanId,
        startTime: "00:00:00",
        endTime: "24:00:00",
    }];
}
