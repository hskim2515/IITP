import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";

import { useNavigationStore, useCurrentFrame } from "@stores/useNavigationStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useSchemaStore } from "@stores/useSchemaStore";

import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { layerNameToHistoryStoreMap } from "@hooks/useHistoryInit";

import { generateGuidWithParentGuid, isGuidSelfOrDescendant } from "@utils/guid";
import { generateTemplate } from "@utils/schema";
import { createEventHandlers } from "@handler/createEventHandlers";
import { useNetworkStore } from "@stores/useNetworkStore";
import {
    updateLinkInNetwork, reconcileSignalConnectionIds, applyNetworkUpdate, markRemovedForTileMask,
    batchDeleteOrMergeNodes, deleteLinkFromNetwork,
    countSignalsForNodes, deleteSignalsForNodes,
    countStationsForNodes, countStationsForLinks, deleteStationsForLinks, deletePavementMarkingsForLinks,
    deletePavementMarkingsForShrunkLanes,
    farNodeIdsForCascadeDelete,
} from "@hooks/useNetworkSelect";
import { GridToolbar } from "./GridToolbar";
import { GridTable } from "./GridTable";

import style from "@css/DrilldownGrid.module.css";
import { getChildrenStructure, getStructureByFeatureType } from "@utils/gridUtils";

type DrilldownGridProps = {
    layerName: string;
    layerGroupName: string;
    currentJsonData?: Record<string, any[]>;
    /** true 면 currentJsonData prop 이 단일 데이터 소스 — feature store 구독으로 네비게이션을
     *  덮어쓰지 않는다 (NETWORK 타일 모드 전체 그리드: store 는 viewport working set 이므로) */
    externalData?: boolean;
    containerHeight?: number;
};

function guidBelongsToRows(rows: any[], targetGuid: string): boolean {
    return rows.some((row) => isGuidSelfOrDescendant(targetGuid, row.__guid));
}

// 삭제 전/후 네트워크를 비교해 실제로 사라진 링크 id를 뽑는다 — busStation/railStation은
// linkRef로 특정 링크를 참조하는 별개 스토어라 링크가 없어져도 자동으로는 안 지워지므로
// (NetworkEditToolbar.tsx의 removedLinkIds와 동일한 목적) deleteStationsForLinks에 넘긴다.
function removedLinkIds(before: { links: { id: string | number }[] }, after: { links: { id: string | number }[] }): string[] {
    const afterIds = new Set(after.links.map((l) => String(l.id)));
    return before.links.filter((l) => !afterIds.has(String(l.id))).map((l) => String(l.id));
}

const DrilldownGrid = ({
                           layerName,
                           layerGroupName,
                           currentJsonData,
                           externalData = false,
                           containerHeight = 600,
                       }: DrilldownGridProps) => {
    const setMessage = useMessageStore.getState().setMessage;
    const dataStore = layerNameToStoreMap[layerName];
    const historyStore = layerNameToHistoryStoreMap[layerName];

    // GridTable 은 AG Grid 특성상 픽셀 높이가 필요하다. GridToolbar/루트탭 높이를 상수로
    // 빼는 대신 실제 tableWrap 을 측정해 넘긴다 — 하단 taskbar 에 그리드가 가려지던 원인.
    const tableWrapRef = useRef<HTMLDivElement>(null);
    const [measuredTableHeight, setMeasuredTableHeight] = useState(0);
    useEffect(() => {
        const el = tableWrapRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        let retryRaf: number | null = null;
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect.height;
            if (typeof h !== "number") return;
            const next = Math.max(0, Math.round(h));
            if (next > 0) {
                setMeasuredTableHeight(next);
                return;
            }
            // 레이아웃 확정 전 프레임에서 0 이 오면 그대로 두면 안 된다 — 0 은 "미측정"으로
            // 취급돼 상위 근사값(containerHeight)으로 되돌아가고, 그 값이 실제 가용 높이보다
            // 크면 그리드 하단(마지막 row·가로 스크롤바)이 패널 밖 taskbar 뒤로 나간다.
            if (retryRaf !== null) return;
            retryRaf = requestAnimationFrame(() => {
                retryRaf = null;
                const cur = tableWrapRef.current?.clientHeight ?? 0;
                if (cur > 0) setMeasuredTableHeight(cur);
            });
        });
        ro.observe(el);
        return () => {
            if (retryRaf !== null) cancelAnimationFrame(retryRaf);
            ro.disconnect();
        };
    }, []);
    // 측정 전 첫 페인트에는 상위가 넘긴 근사값 사용 (측정되면 그 값이 우선)
    const tableHeight = measuredTableHeight > 0
        ? measuredTableHeight
        : Math.max(0, Number.isFinite(containerHeight) ? containerHeight : 0);

    const init = useNavigationStore((s) => s.init);
    const clear = useNavigationStore((s) => s.clear);
    const rebuildStack = useNavigationStore((s) => s.rebuildStack);
    const frame = useCurrentFrame();

    const selectedGuid = useSelectionStore((s) => s.selectedGuid);
    const clearSelected = useSelectionStore((s) => s.clearSelected);

    const { getSchemaDefinitionByNames, getStructureByLayerName } = useSchemaStore();

    const rootKeys = useMemo(() => {
        const data = (currentJsonData ?? dataStore.getState().currentJsonData) as Record<string, any[]> | undefined;
        return Object.keys(data ?? {}).filter(key => Array.isArray((data as any)?.[key]));
    }, [currentJsonData, dataStore]);
    const [activeRootKey, setActiveRootKey] = useState<string | null>(null);

    useEffect(() => {
        if (rootKeys.length > 0 && !rootKeys.includes(activeRootKey ?? "")) {
            setActiveRootKey(rootKeys[0] ?? null);
        }
    }, [rootKeys, activeRootKey]);

    useEffect(() => {
        if (!selectedGuid?.length || !currentJsonData || !activeRootKey) return;
        const targetGuid = selectedGuid[0] as string;
        if (!targetGuid) return;

        const currentRows = currentJsonData[activeRootKey] ?? [];
        if (guidBelongsToRows(currentRows, targetGuid)) return;

        for (const key of rootKeys) {
            if (key === activeRootKey) continue;
            if (guidBelongsToRows(currentJsonData[key] ?? [], targetGuid)) {
                setActiveRootKey(key);
                return;
            }
        }
    }, [selectedGuid, currentJsonData, activeRootKey, rootKeys]);

    const syncNavigationFromData = useCallback((data: Record<string, any[]> | undefined) => {
        if (!activeRootKey || !data || !data[activeRootKey]) return;

        const rowData = data[activeRootKey];
        const layerStructure = getStructureByLayerName(layerName);
        const rootStructure = getStructureByFeatureType(layerStructure, activeRootKey);
        const children = getChildrenStructure(rootStructure);

        const currentStack = useNavigationStore.getState().stack;
        if (currentStack.length > 1 && currentStack[0].levelName === activeRootKey) {
            rebuildStack(rowData);
            return;
        }

        init({
            levelName: activeRootKey,
            rows: rowData,
            breadLabel: activeRootKey,
            hasChildren: children.length > 0,
        });

        // 선택 유지 판정은 "현재 활성 root(rowData)"가 아니라 "데이터의 모든 root"를 기준으로 한다.
        //   속성모달 편집 버튼으로 새 그리드를 열면 activeRootKey 는 rootKeys[0](예: nodes)로 시작하는데,
        //   대상이 다른 root(예: links)면 여기서 clearSelected() 로 지워져, root 전환 effect(대상이 속한
        //   root 로 activeRootKey 를 옮김)가 동작하기도 전에 선택이 사라진다. 어느 root 에든 속하면
        //   유지해 root 전환이 끝난 뒤 그 root 에서 체크·드릴다운되게 한다.
        const pendingGuid = useSelectionStore.getState().selectedGuid[0] as string | undefined;
        const rootsInData = Object.keys(data).filter((k) => Array.isArray(data[k]));
        const belongsSomewhere = !!pendingGuid
            && rootsInData.some((k) => guidBelongsToRows(data[k] ?? [], pendingGuid as string));
        if (!pendingGuid || !belongsSomewhere) {
            clearSelected();
        }
    }, [layerName, activeRootKey, init, rebuildStack, clearSelected, getStructureByLayerName]);

    // feature store를 직접 구독하여 currentJsonData 변경 시 즉시 네비게이션 동기화
    // (undo/redo 포함, React 렌더 사이클에 의존하지 않음)
    // externalData 모드에서는 store 가 viewport working set 이라 구독하면 전체 목록을 덮어쓴다 — 스킵.
    useEffect(() => {
        if (externalData) return;
        return dataStore.subscribe(
            (state: any) => state.currentJsonData,
            (newData: any) => {
                syncNavigationFromData(newData as Record<string, any[]>);
            }
        );
    }, [dataStore, syncNavigationFromData, externalData]);

    useEffect(() => {
        syncNavigationFromData(currentJsonData as Record<string, any[]>);
    }, [layerName, activeRootKey, currentJsonData, syncNavigationFromData]);

    useEffect(() => {
        return () => clear();
    }, [layerName, clear]);

    // network 레이어의 링크 행에서 numLane/width를 편집하면 차선 배열 재생성 → 사라진
    // 차선을 참조하던 커넥션 정리 → 그 커넥션을 참조하던 신호까지 연쇄로 정리해야 한다
    // (도로 편집 모드의 NetworkSelectPanel과 동일한 규칙 — useNetworkSelect.updateLinkInNetwork/
    // reconcileSignalConnectionIds). 그리드 편집은 지금까지 이 연쇄 없이 필드만 그대로
    // 덮어써서, 차선 수를 줄이면 존재하지 않는 차선을 참조하는 커넥션이 그대로 남고
    // (렌더/시뮬 인덱스 오류), 그 커넥션을 쓰던 신호도 죽은 참조를 계속 들고 있었다.
    const handleCellUpdate = useCallback(
        (record: any, partial: Partial<Record<string, any>>) => {
            const isNetworkLink = layerName === "network" && record?.featureType === "links";
            const touchesLaneLayout = "numLane" in partial || "width" in partial;

            if (isNetworkLink && touchesLaneLayout) {
                const cur = useNetworkStore.getState().currentJsonData;
                const linkId = record.id;
                const curLink = cur?.links?.find((l: any) => String(l.id) === String(linkId));
                if (cur && curLink) {
                    let droppedConnCount = 0;
                    const newNumLane = partial.numLane;
                    if (newNumLane !== undefined && newNumLane < curLink.numLane) {
                        droppedConnCount = cur.nodes
                            .filter((n: any) => String(n.id) === String(curLink.fromNode) || String(n.id) === String(curLink.toNode))
                            .reduce((sum: number, n: any) => sum + n.connections.filter((c: any) =>
                                (String(c.fromLink) === String(linkId) && c.fromLane >= newNumLane) ||
                                (String(c.toLink) === String(linkId) && c.toLane >= newNumLane)
                            ).length, 0);
                    }
                    const updated = updateLinkInNetwork(cur, linkId, partial);
                    applyNetworkUpdate(updated);
                    const clearedCount = reconcileSignalConnectionIds(updated, [curLink.fromNode, curLink.toNode]);
                    let removedMarkingCount = 0;
                    if (newNumLane !== undefined && newNumLane < curLink.numLane) {
                        const updatedLink = updated.links.find((l: any) => String(l.id) === String(linkId));
                        const remainingLaneIds = new Set((updatedLink?.lanes ?? []).map((l: any) => l.id));
                        removedMarkingCount = deletePavementMarkingsForShrunkLanes(linkId, remainingLaneIds);
                    }
                    if (droppedConnCount > 0 || clearedCount > 0 || removedMarkingCount > 0) {
                        setMessage({
                            type: "info",
                            text: `차선 수 감소로 커넥션 ${droppedConnCount}개 삭제됨${clearedCount > 0 ? ` (신호 ${clearedCount}개의 커넥션 참조 초기화)` : ""}${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ""}`,
                        });
                    }
                    return;
                }
            }

            const merged = { ...record, ...partial };
            dataStore.getState().updateCurrentJsonData(merged, historyStore);
        },
        [dataStore, historyStore, layerName, setMessage]
    );

    // handleDelete(레인/커넥션/포트 삭제 → numLane/numConnection/numPort 감소 동기화)와
    // 대칭 — 추가 쪽도 부모 링크/노드의 파생 카운트 필드를 실제 배열 길이로 동기화해야
    // numLane 필드 편집 캐스케이드(handleCellUpdate)와 동일한 결과를 "행 추가" 경로에서도
    // 보장한다. 레인 id는 fromLane/toLane이 배열 인덱스처럼 참조하는 값이라 Date.now() 같은
    // 임의의 큰 수를 쓰면 커넥션 연동이 깨지므로, 부모 레인 배열의 다음 순번으로 맞춘다.
    const handleAdd = useCallback(() => {
        const currentFrame = useNavigationStore.getState().stack.at(-1);
        if (!currentFrame) return;

        const targetSchema = getSchemaDefinitionByNames(layerName, currentFrame.levelName);
        const template = generateTemplate(targetSchema);
        const tempRecord: Record<string, any> = {
            ...(template ?? {}),
            featureType: currentFrame.levelName,
            layerName: layerName,
            id: Date.now(),
            __guid: undefined,
            parentGuid: currentFrame.parentGuid ?? null,
        };

        const isNetworkLayer = layerName === "network";
        const levelName = currentFrame.levelName;
        const parentRecord = currentFrame.parentRecord;
        if (isNetworkLayer && levelName === "lanes" && parentRecord) {
            tempRecord.id = parentRecord.lanes?.length ?? 0;
            tempRecord.linkRef = parentRecord.id;
        }

        generateGuidWithParentGuid(currentFrame.parentGuid, tempRecord, currentFrame.rows);
        createEventHandlers(tempRecord);

        if (isNetworkLayer && parentRecord?.id != null) {
            const cur = useNetworkStore.getState().currentJsonData;
            if (levelName === "lanes") {
                const curLink = cur?.links?.find((l: any) => String(l.id) === String(parentRecord.id));
                const actualNumLane = curLink?.lanes?.length ?? 0;
                if (curLink && actualNumLane !== curLink.numLane) {
                    useNetworkStore.getState().updateCurrentJsonData(
                        { __guid: curLink.__guid, numLane: actualNumLane } as any, historyStore,
                    );
                }
            } else if (levelName === "connections") {
                const curNode = cur?.nodes?.find((n: any) => String(n.id) === String(parentRecord.id));
                const actualNumConnection = curNode?.connections?.length ?? 0;
                if (curNode && actualNumConnection !== curNode.numConnection) {
                    useNetworkStore.getState().updateCurrentJsonData(
                        { __guid: curNode.__guid, numConnection: actualNumConnection } as any, historyStore,
                    );
                }
            } else if (levelName === "ports") {
                const curNode = cur?.nodes?.find((n: any) => String(n.id) === String(parentRecord.id));
                const actualNumPort = curNode?.ports?.length ?? 0;
                if (curNode && actualNumPort !== curNode.numPort) {
                    useNetworkStore.getState().updateCurrentJsonData(
                        { __guid: curNode.__guid, numPort: actualNumPort } as any, historyStore,
                    );
                }
                setMessage({ type: "info", text: "포트가 추가되었습니다. ⚠ linkId를 실제 존재하는 링크로 지정해야 유효합니다." });
            }
        }
    }, [layerName, getSchemaDefinitionByNames, setMessage, historyStore]);

    // network 레이어에서 링크의 lanes/노드의 connections·ports 행을 그리드로 직접 삭제하면
    // (numLane/width 필드 편집과 달리) 부모 링크/노드의 numLane·numConnection·numPort 같은
    // 파생 카운트 필드가 실제 배열 길이와 어긋난 채로 남는다 — 레인을 지워도 numLane 이
    // 그대로면 사라진 차선을 여전히 참조하는 커넥션(과 그 커넥션을 쓰는 신호)도 정리가 안
    // 된다. handleCellUpdate의 numLane 필드 편집 캐스케이드와 동일한 결과를 "행 삭제"
    // 경로에서도 보장하기 위해, 삭제 직후 부모 레코드(useNavigationStore의 parentRecord —
    // 지금 드릴다운한 프레임의 실제 부모 객체)를 기준으로 카운트를 재동기화한다.
    // 그리드 최상위 레벨(nodes/links)에서 직접 삭제하면 지도 툴(NetworkEditToolbar.tsx)이
    // 제공하는 캐스케이드(연결 Link/Signal/정류장 정리, 통과 노드 병합)가 전혀 없이 참조
    // 무결성이 깨진 채로 저장되는 문제가 있었다 — 지도 툴이 쓰는 것과 동일한
    // useNetworkSelect.ts의 순수 함수들을 그대로 재사용해 같은 캐스케이드를 보장한다.
    const handleRootNetworkDelete = useCallback((levelName: "nodes" | "links", rows: any[], guids: (string | React.Key)[]) => {
        const net = useNetworkStore.getState().currentJsonData;
        const ids = guids
            .map((g) => rows.find((r: any) => r.__guid === g)?.id)
            .filter((id): id is number | string => id != null);
        if (!net || ids.length === 0) {
            clearSelected();
            return;
        }

        let extra = "";
        if (levelName === "nodes") {
            const signalCount = countSignalsForNodes(ids);
            const farIds = farNodeIdsForCascadeDelete(net, ids);
            const next = batchDeleteOrMergeNodes(net, ids);
            applyNetworkUpdate(next);
            const clearedCount = reconcileSignalConnectionIds(next, farIds);
            deleteSignalsForNodes(ids);
            const removedStationCount = deleteStationsForLinks(removedLinkIds(net, next));
            const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(net, next));
            markRemovedForTileMask(net, next);
            extra = `${signalCount > 0 ? `, 신호 ${signalCount}개 삭제` : ""}`
                + `${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ""}`
                + `${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ""}`
                + `${clearedCount > 0 ? `, 인접 신호 ${clearedCount}개 커넥션 참조 초기화` : ""}`;
        } else {
            const affectedNodeIds = new Set<string>();
            for (const linkId of ids) {
                const link = net.links.find((l: any) => String(l.id) === String(linkId));
                if (link) { affectedNodeIds.add(String(link.fromNode)); affectedNodeIds.add(String(link.toNode)); }
            }
            let next = net;
            for (const linkId of ids) next = deleteLinkFromNetwork(next, linkId);
            applyNetworkUpdate(next);
            const clearedCount = reconcileSignalConnectionIds(next, [...affectedNodeIds]);
            const removedStationCount = deleteStationsForLinks(removedLinkIds(net, next));
            const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(net, next));
            markRemovedForTileMask(net, next);
            extra = `${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ""}`
                + `${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ""}`
                + `${clearedCount > 0 ? `, 신호 ${clearedCount}개의 커넥션 참조 초기화` : ""}`;
        }

        setMessage({ type: "info", text: `${ids.length}개 항목이 삭제되었습니다.${extra}` });
        clearSelected();
    }, [clearSelected, setMessage]);

    const handleDelete = useCallback(() => {
        const currentSelectedGuid = useSelectionStore.getState().selectedGuid;
        if (!currentSelectedGuid || currentSelectedGuid.length === 0) {
            setMessage({ type: "warn", text: "삭제할 항목을 선택해주세요." });
            return;
        }

        const currentFrame = useNavigationStore.getState().stack.at(-1);
        const levelName = currentFrame?.levelName;
        const parentRecord = currentFrame?.parentRecord;
        const isNetworkLayer = layerName === "network";

        if (isNetworkLayer && !parentRecord && (levelName === "nodes" || levelName === "links")) {
            handleRootNetworkDelete(levelName, currentFrame?.rows ?? [], currentSelectedGuid);
            return;
        }

        dataStore.getState().removeRecordsByGuid(currentSelectedGuid, historyStore);

        let extra = "";
        if (isNetworkLayer && levelName === "lanes" && parentRecord?.id != null) {
            const cur = useNetworkStore.getState().currentJsonData;
            const curLink = cur?.links?.find((l: any) => String(l.id) === String(parentRecord.id));
            if (cur && curLink) {
                const actualNumLane = curLink.lanes?.length ?? 0;
                const remainingLaneIds = new Set((curLink.lanes ?? []).map((l: any) => l.id));
                if (actualNumLane !== curLink.numLane) {
                    useNetworkStore.getState().updateCurrentJsonData(
                        { __guid: curLink.__guid, numLane: actualNumLane } as any, historyStore,
                    );
                }
                // 사라진 차선을 참조하던 커넥션 정리 (fromLink/toLink 양쪽 다 확인)
                const affectedNodes = cur.nodes.filter((n: any) =>
                    String(n.id) === String(curLink.fromNode) || String(n.id) === String(curLink.toNode));
                const danglingConnGuids: string[] = [];
                for (const n of affectedNodes) {
                    for (const c of n.connections ?? []) {
                        const refsGoneLane =
                            (String(c.fromLink) === String(parentRecord.id) && !remainingLaneIds.has(c.fromLane)) ||
                            (String(c.toLink) === String(parentRecord.id) && !remainingLaneIds.has(c.toLane));
                        if (refsGoneLane && c.__guid) danglingConnGuids.push(c.__guid);
                    }
                }
                if (danglingConnGuids.length > 0) {
                    useNetworkStore.getState().removeRecordsByGuid(danglingConnGuids, historyStore);
                }
                const afterNet = useNetworkStore.getState().currentJsonData;
                const clearedCount = afterNet
                    ? reconcileSignalConnectionIds(afterNet, [curLink.fromNode, curLink.toNode]) : 0;
                const removedMarkingCount = deletePavementMarkingsForShrunkLanes(parentRecord.id, remainingLaneIds);
                extra = `${danglingConnGuids.length > 0 ? `, 커넥션 ${danglingConnGuids.length}개 삭제` : ""}`
                    + `${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ""}`
                    + `${clearedCount > 0 ? `, 신호 ${clearedCount}개의 커넥션 참조 초기화` : ""}`;
            }
        } else if (isNetworkLayer && levelName === "connections" && parentRecord?.id != null) {
            const cur = useNetworkStore.getState().currentJsonData;
            const curNode = cur?.nodes?.find((n: any) => String(n.id) === String(parentRecord.id));
            if (cur && curNode) {
                const actualNumConnection = curNode.connections?.length ?? 0;
                if (actualNumConnection !== curNode.numConnection) {
                    useNetworkStore.getState().updateCurrentJsonData(
                        { __guid: curNode.__guid, numConnection: actualNumConnection } as any, historyStore,
                    );
                }
                // 삭제된 커넥션 id를 여전히 참조하던 신호 정리
                const afterNet = useNetworkStore.getState().currentJsonData;
                const clearedCount = afterNet ? reconcileSignalConnectionIds(afterNet, [curNode.id]) : 0;
                extra = clearedCount > 0 ? `, 신호 ${clearedCount}개의 커넥션 참조 초기화` : "";
            }
        } else if (isNetworkLayer && levelName === "ports" && parentRecord?.id != null) {
            // 포트는 링크가 이 노드에 연결된다는 사실 자체를 나타내는 파생 레코드라
            // 포트만 지우고 링크는 남기면 그 링크가 존재하지 않는 연결을 계속 참조하는
            // 구조적으로 잘못된 상태가 된다 — 지도 툴의 링크 삭제와 동일하게, 포트가
            // 가리키던 링크를 통째로 deleteLinkFromNetwork로 cascade 삭제한다
            // (반대편 노드의 ports/connections 정리까지 포함).
            const preRows = currentFrame?.rows ?? [];
            const deletedLinkIds = [...new Set(
                currentSelectedGuid
                    .map((g) => preRows.find((r: any) => r.__guid === g)?.linkId)
                    .filter((id: any) => id != null)
                    .map((id: any) => String(id))
            )];
            const beforeNet = useNetworkStore.getState().currentJsonData;
            if (beforeNet && deletedLinkIds.length > 0) {
                let next = beforeNet;
                const affectedNodeIds = new Set<string>();
                for (const linkId of deletedLinkIds) {
                    const link = next.links.find((l: any) => String(l.id) === linkId);
                    if (link) { affectedNodeIds.add(String(link.fromNode)); affectedNodeIds.add(String(link.toNode)); }
                    next = deleteLinkFromNetwork(next, linkId);
                }
                applyNetworkUpdate(next);
                const clearedCount = reconcileSignalConnectionIds(next, [...affectedNodeIds]);
                const removedStationCount = deleteStationsForLinks(removedLinkIds(beforeNet, next));
                const removedMarkingCount = deletePavementMarkingsForLinks(removedLinkIds(beforeNet, next));
                markRemovedForTileMask(beforeNet, next);
                extra = ` — 참조하던 링크 ${deletedLinkIds.length}개도 함께 삭제됨`
                    + `${removedStationCount > 0 ? `, 정류장 ${removedStationCount}개 삭제` : ""}`
                    + `${removedMarkingCount > 0 ? `, 노면표시 ${removedMarkingCount}개 삭제` : ""}`
                    + `${clearedCount > 0 ? `, 신호 ${clearedCount}개의 커넥션 참조 초기화` : ""}`;
            }
        }

        setMessage({ type: "info", text: `${currentSelectedGuid.length}개 항목이 삭제되었습니다.${extra}` });
        clearSelected();
    }, [dataStore, historyStore, clearSelected, setMessage, layerName, handleRootNetworkDelete]);

    const handleSave = useCallback(() => {
        dataStore.getState().save?.();
    }, [dataStore]);

    // 데이터 없음 상태
    if (!frame || rootKeys.length === 0) {
        return (
            <div className={style.container}>
                <div className={style.emptyWrap}>
                    <span className={style.emptyIcon}>⚠</span>
                    <span className={style.emptyTitle}>데이터가 없습니다</span>
                    <span className={style.emptyDesc}>
                        서버에서 불러온 데이터가 없습니다.<br />
                        OSM 가져오기 또는 XML 임포트로 데이터를 추가하세요.
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className={style.container}>
            <GridToolbar
                onAdd={handleAdd}
                onDelete={handleDelete}
                onSave={handleSave}
                rootKeys={rootKeys}
                activeRootKey={activeRootKey ?? ""}
                onRootChange={(key) => {
                    clearSelected();
                    setActiveRootKey(key);
                }}
            />

            <div ref={tableWrapRef} className={style.tableWrap}>
                <GridTable
                    key={`${frame.levelName}-${frame.parentGuid || 'root'}`}
                    layerName={layerName}
                    layerGroupName={layerGroupName}
                    frame={frame}
                    containerHeight={tableHeight}
                    onCellUpdate={handleCellUpdate}
                />
            </div>
        </div>
    );
};

export default DrilldownGrid;
