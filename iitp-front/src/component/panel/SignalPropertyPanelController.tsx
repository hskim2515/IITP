import React, { useState } from "react";
import SignalTodTimelineEditor from "@component/util/SignalTodTimelineEditor";
import SignalWorkspaceEditor, {
    SignalWorkspaceTab,
} from "@component/util/SignalWorkspaceEditor";
import { useMessageStore } from "@stores/useMessageStore";
import { useScenarioStore } from "@stores/useScenarioStore";
import { HistoryStoreFactoryType } from "@stores/useHistoryStoreFactory";
import {
    useSignalPlanHistoryStore,
    useSignalStore,
    useSignalTurnHistoryStore,
} from "@stores/useSignalStore";
import { useSignalTodHistoryStore, useSignalTodStore } from "@stores/useSignalTodStore";
import { UpdateLogEntry } from "@type/HistoryTypes";
import { mergeJsonWithLogRecursive } from "@utils/history";
import {
    validateSignalPlansAgainstSignals,
    validateSignalTodAgainstSignal,
} from "@utils/nextSimValidation";
import {
    getSignalHistoryTransactionId,
    hasHistoryStoreChanges,
    mergeScopedSignalHistory,
    SignalHistoryScope,
} from "@utils/signalHistory";

export interface SignalPropertyPanelContext {
    historyMenuCode: string;
    historyStore: HistoryStoreFactoryType;
    historyScope: SignalHistoryScope;
    content: React.ReactNode;
    onSave: () => Promise<void>;
    onInit: () => void;
    onHistoryApply: (isUndo: boolean) => void;
}

interface SignalPropertyPanelControllerProps {
    menuCode: "SIGNAL" | "SIGNAL_TOD";
    containerHeight: number;
    saveMenuData: (
        menuCode: string,
        versionKey: string,
        options?: {
            logs?: UpdateLogEntry;
            historyStoresToReset?: HistoryStoreFactoryType[];
        },
    ) => Promise<void>;
    onSaved: () => void;
    children: (context: SignalPropertyPanelContext) => React.ReactNode;
}

const SignalPropertyPanelController: React.FC<SignalPropertyPanelControllerProps> = ({
    menuCode,
    containerHeight,
    saveMenuData,
    onSaved,
    children,
}) => {
    const [activeTab, setActiveTab] = useState<SignalWorkspaceTab>("movements");
    const setMessage = useMessageStore.getState().setMessage;
    const activeHistoryScope: SignalHistoryScope = menuCode === "SIGNAL_TOD" || activeTab === "tod"
        ? "TOD"
        : activeTab === "plans"
            ? "PLAN"
            : "TURN";
    const effectiveHistoryMenuCode = activeHistoryScope === "TOD" ? "SIGNAL_TOD" : "SIGNAL";
    const activeActionStore = activeHistoryScope === "TOD" ? useSignalTodStore : useSignalStore;
    const activeActionHistoryStore = activeHistoryScope === "TOD"
        ? useSignalTodHistoryStore
        : activeHistoryScope === "PLAN"
            ? useSignalPlanHistoryStore
            : useSignalTurnHistoryStore;

    const onSave = async () => {
        const { selectedScenario, selectedScenarioVersion } = useScenarioStore.getState();
        if (!selectedScenario || !selectedScenarioVersion) return;

        if (menuCode === "SIGNAL_TOD") {
            if (!hasHistoryStoreChanges(useSignalTodHistoryStore)) {
                setMessage({ type: "warn", text: "변경사항이 없습니다." });
                return;
            }

            const validation = validateSignalTodAgainstSignal();
            if (!validation.ok) {
                const firstIssue = validation.issues[0] ?? "신호 TOD 데이터가 올바르지 않습니다.";
                setMessage({
                    type: "error",
                    text: `저장할 수 없습니다 (${validation.issues.length}건): ${firstIssue}`,
                });
                return;
            }

            try {
                await saveMenuData("SIGNAL_TOD", selectedScenarioVersion.key, {
                    logs: mergeScopedSignalHistory([
                        { scope: "TOD", store: useSignalTodHistoryStore },
                    ]),
                    historyStoresToReset: [useSignalTodHistoryStore],
                });
                onSaved();
                setMessage({ type: "info", text: "저장 완료" });
            } catch (error) {
                setMessage({ type: "error", text: "저장 실패: " + error });
            }
            return;
        }

        const signalChanged = hasHistoryStoreChanges(useSignalTurnHistoryStore)
            || hasHistoryStoreChanges(useSignalPlanHistoryStore);
        const todChanged = hasHistoryStoreChanges(useSignalTodHistoryStore);
        if (!signalChanged && !todChanged) {
            setMessage({ type: "warn", text: "변경사항이 없습니다." });
            return;
        }

        const signalValidation = validateSignalPlansAgainstSignals();
        if (signalChanged && !signalValidation.ok) {
            const firstIssue = signalValidation.issues[0] ?? "신호 Plan 데이터가 올바르지 않습니다.";
            setMessage({
                type: "error",
                text: `저장할 수 없습니다 (${signalValidation.issues.length}건): ${firstIssue}`,
            });
            return;
        }

        const todValidation = validateSignalTodAgainstSignal();
        if (todChanged && !todValidation.ok) {
            const firstIssue = todValidation.issues[0] ?? "신호 TOD 데이터가 올바르지 않습니다.";
            setMessage({
                type: "error",
                text: `저장할 수 없습니다 (${todValidation.issues.length}건): ${firstIssue}`,
            });
            return;
        }

        const saved: string[] = [];
        const failed: string[] = [];
        if (signalChanged) {
            try {
                await saveMenuData("SIGNAL", selectedScenarioVersion.key, {
                    logs: mergeScopedSignalHistory([
                        { scope: "TURN", store: useSignalTurnHistoryStore },
                        { scope: "PLAN", store: useSignalPlanHistoryStore },
                    ]),
                    historyStoresToReset: [
                        useSignalTurnHistoryStore,
                        useSignalPlanHistoryStore,
                    ],
                });
                saved.push("Signal");
            } catch {
                failed.push("Signal");
            }
        }
        if (todChanged) {
            try {
                await saveMenuData("SIGNAL_TOD", selectedScenarioVersion.key, {
                    logs: mergeScopedSignalHistory([
                        { scope: "TOD", store: useSignalTodHistoryStore },
                    ]),
                    historyStoresToReset: [useSignalTodHistoryStore],
                });
                saved.push("TOD");
            } catch {
                failed.push("TOD");
            }
        }

        onSaved();
        if (failed.length > 0) {
            setMessage({
                type: "error",
                text: `${saved.length > 0 ? `${saved.join(", ")} 저장 완료 · ` : ""}${failed.join(", ")} 저장 실패`,
            });
        } else {
            setMessage({ type: "info", text: `${saved.join(", ")} 저장 완료` });
        }
    };

    const onInit = () => {
        if (!activeActionStore || !activeActionHistoryStore) return;
        let currentJsonData = activeActionStore.getState().currentJsonData;
        while (activeActionHistoryStore.getState().undoStack.length > 0) {
            const updateHistory = activeActionHistoryStore.getState().undo();
            if (!updateHistory) break;
            currentJsonData = mergeJsonWithLogRecursive(currentJsonData, updateHistory, true);
        }
        activeActionStore.getState().setCurrentJsonData(currentJsonData);
        activeActionHistoryStore.getState().resetAllHistoryStack();
        activeActionHistoryStore.getState().resetSnapshotUpdateLogs();
        activeActionHistoryStore.getState().setCurrentSnapshotIndex(null);
        const hasRemainingChanges = activeHistoryScope === "TOD"
            ? hasHistoryStoreChanges(useSignalTodHistoryStore)
            : hasHistoryStoreChanges(useSignalTurnHistoryStore)
                || hasHistoryStoreChanges(useSignalPlanHistoryStore);
        activeActionStore.getState().setChange(hasRemainingChanges);
    };

    const onHistoryApply = (isUndo: boolean) => {
        if (!activeActionHistoryStore || !activeActionStore) return;

        const activeHistoryState = activeActionHistoryStore.getState();
        const activeStack = isUndo ? activeHistoryState.undoStack : activeHistoryState.redoStack;
        const transactionId = getSignalHistoryTransactionId(activeStack.at(-1)?.json);

        const applyNextHistory = (
            historyStore: HistoryStoreFactoryType,
            featureStore: typeof useSignalStore | typeof useSignalTodStore,
        ): boolean => {
            const historyFn = isUndo
                ? historyStore.getState().undo
                : historyStore.getState().redo;
            const updateHistory = historyFn();
            if (!updateHistory) return false;
            const currentJsonData = featureStore.getState().currentJsonData;
            const mergedJsonData = mergeJsonWithLogRecursive(
                currentJsonData,
                updateHistory,
                isUndo,
            );
            featureStore.getState().setCurrentJsonData(mergedJsonData);
            return true;
        };

        if (!transactionId) {
            if (!applyNextHistory(activeActionHistoryStore, activeActionStore)) {
                console.warn(isUndo ? "No more undo steps available." : "No more redo steps available.");
                return;
            }
        } else {
            const historyTargets = isUndo
                ? [
                    { history: useSignalTodHistoryStore, feature: useSignalTodStore },
                    { history: useSignalPlanHistoryStore, feature: useSignalStore },
                    { history: useSignalTurnHistoryStore, feature: useSignalStore },
                ]
                : [
                    { history: useSignalTurnHistoryStore, feature: useSignalStore },
                    { history: useSignalPlanHistoryStore, feature: useSignalStore },
                    { history: useSignalTodHistoryStore, feature: useSignalTodStore },
                ];

            for (const target of historyTargets) {
                while (true) {
                    const state = target.history.getState();
                    const stack = isUndo ? state.undoStack : state.redoStack;
                    const nextTransactionId = getSignalHistoryTransactionId(stack.at(-1)?.json);
                    if (nextTransactionId !== transactionId) break;
                    if (!applyNextHistory(target.history, target.feature)) break;
                }
            }
        }

        const signalChanged = hasHistoryStoreChanges(useSignalTurnHistoryStore)
            || hasHistoryStoreChanges(useSignalPlanHistoryStore);
        const todChanged = hasHistoryStoreChanges(useSignalTodHistoryStore);
        useSignalStore.getState().setChange(signalChanged);
        useSignalTodStore.getState().setChange(todChanged);
        setMessage({
            type: "info",
            text: transactionId
                ? isUndo ? "자동 생성 작업 전체를 되돌렸습니다." : "자동 생성 작업 전체를 다시 적용했습니다."
                : isUndo ? "Undo 성공" : "Redo 성공",
        });
    };

    const content = menuCode === "SIGNAL_TOD" ? (
        <SignalTodTimelineEditor containerHeight={containerHeight} />
    ) : (
        <SignalWorkspaceEditor
            containerHeight={containerHeight}
            onTabChange={setActiveTab}
        />
    );

    return children({
        historyMenuCode: effectiveHistoryMenuCode,
        historyStore: activeActionHistoryStore,
        historyScope: activeHistoryScope,
        content,
        onSave,
        onInit,
        onHistoryApply,
    });
};

export default SignalPropertyPanelController;
