import { HistoryStoreFactoryType } from "@stores/useHistoryStoreFactory";
import { FieldChange, UpdateLogEntry } from "@type/HistoryTypes";
import { mergeUpdateLogs } from "@utils/history";

export type SignalHistoryScope = "TURN" | "PLAN" | "TOD";

export const createSignalHistoryTransactionId = (action: string): string =>
    `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const isPlanChange = (change: FieldChange): boolean => {
    const guid = String(change.guid ?? "");
    return guid.includes(".plans-")
        || guid.includes(".phases-");
};

export const resolveSignalHistoryScope = (
    change: FieldChange,
    fallbackScope: SignalHistoryScope,
    updateType: "added" | "modified" | "deleted" = "modified",
): SignalHistoryScope => {
    if (change.scope) return change.scope;
    if (fallbackScope === "TOD") return "TOD";
    const field = String(change.field ?? "");
    const modifiesPlanField = updateType === "modified"
        && (field === "plans" || field.startsWith("plans."));
    return isPlanChange(change) || modifiesPlanField ? "PLAN" : fallbackScope;
};

export const scopeSignalHistoryEntry = (
    entry: UpdateLogEntry,
    fallbackScope: SignalHistoryScope,
): UpdateLogEntry => ({
    added: entry.added?.map(change => ({
        ...change,
        scope: resolveSignalHistoryScope(change, fallbackScope, "added"),
    })),
    modified: entry.modified?.map(change => ({
        ...change,
        scope: resolveSignalHistoryScope(change, fallbackScope, "modified"),
    })),
    deleted: entry.deleted?.map(change => ({
        ...change,
        scope: resolveSignalHistoryScope(change, fallbackScope, "deleted"),
    })),
});

export const mergeScopedSignalHistory = (
    histories: Array<{
        scope: SignalHistoryScope;
        store: HistoryStoreFactoryType;
    }>,
): UpdateLogEntry => {
    const merged: UpdateLogEntry = { added: [], modified: [], deleted: [] };

    for (const history of histories) {
        const state = history.store.getState();
        const scoped = scopeSignalHistoryEntry(
            mergeUpdateLogs(state.updateLogs, state.snapshotUpdateLogs),
            history.scope,
        );
        merged.added!.push(...(scoped.added ?? []));
        merged.modified!.push(...(scoped.modified ?? []));
        merged.deleted!.push(...(scoped.deleted ?? []));
    }

    return merged;
};

export const filterSignalHistoryEntry = (
    entry: UpdateLogEntry,
    scope: SignalHistoryScope,
): UpdateLogEntry => {
    const legacyFallbackScope: SignalHistoryScope = scope === "TOD" ? "TOD" : "TURN";
    return {
        added: entry.added?.filter(
            change => resolveSignalHistoryScope(change, legacyFallbackScope, "added") === scope,
        ),
        modified: entry.modified?.filter(
            change => resolveSignalHistoryScope(change, legacyFallbackScope, "modified") === scope,
        ),
        deleted: entry.deleted?.filter(
            change => resolveSignalHistoryScope(change, legacyFallbackScope, "deleted") === scope,
        ),
    };
};

export const hasHistoryEntryChanges = (entry: UpdateLogEntry): boolean =>
    (entry.added?.length ?? 0) > 0
    || (entry.modified?.length ?? 0) > 0
    || (entry.deleted?.length ?? 0) > 0;

export const hasHistoryStoreChanges = (store: HistoryStoreFactoryType): boolean => {
    const state = store.getState();
    return state.updateLogs.length > 0 || state.snapshotUpdateLogs.length > 0;
};

export const getSignalHistoryTransactionId = (
    entry: UpdateLogEntry | null | undefined,
): string | undefined => {
    if (!entry) return undefined;
    return entry.added?.find(change => change.transactionId)?.transactionId
        ?? entry.modified?.find(change => change.transactionId)?.transactionId
        ?? entry.deleted?.find(change => change.transactionId)?.transactionId;
};
