import { LAYER_CONFIG } from '@component/tool/DataIOPanel';
import { apiConfig, ApiMenuKey } from '@config/apiConfig';
import axiosInstance from '@api/axiosInstance';
import { mergeUpdateLogs } from '@utils/history';
import { useLogStore } from '@stores/useLogStore';
import { useVehicleStore } from '@stores/useVehicleStore';
import { useSimulationStore } from '@stores/useSimulationStore';
import { useSignalTimelineStore } from '@stores/useSignalTimelineStore';
import { showConfirm } from '@utils/dialog';

export function collectDependentStoreData(): Record<string, unknown> {
    const storeData: Record<string, unknown> = {};
    for (const cfg of LAYER_CONFIG) {
        if (cfg.key === 'network') continue;
        const currentJson = cfg.store.getState().currentJsonData;
        if (!currentJson) continue;
        const data = (cfg as any).fullData
            ? currentJson
            : Object.values(currentJson as Record<string, unknown>)[0];
        if (data) storeData[cfg.key] = data;
    }
    return storeData;
}

/** 확인 없이 바로 ZIP 다운로드 (내부/외부 공용) */
export async function downloadBackupZip(versionKey: string, storeData: Record<string, unknown>): Promise<void> {
    try {
        const resp = await axiosInstance.post(
            `/network/${versionKey}/dependent/zip`,
            storeData,
            { responseType: 'blob' },
        );
        const blob = new Blob([resp.data], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_${versionKey}_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        useLogStore.getState().addLog('info', '백업 ZIP 다운로드 완료');
    } catch (e) {
        console.warn('[backup] ZIP 다운로드 실패', e);
        useLogStore.getState().addLog('warn', '백업 ZIP 다운로드 실패');
    }
}

/**
 * 사용자에게 확인 후 백업 ZIP 다운로드.
 * ZIP에는 network.xml + signal.xml + vehicle_sim.db + 현재 레이어 JSON이 포함됩니다.
 */
export async function confirmAndDownloadBackup(versionKey: string): Promise<void> {
    const storeData = collectDependentStoreData();
    const confirmed = await showConfirm(
        '기존 데이터를 백업 ZIP으로 다운로드하시겠습니까?\n(network.xml · 신호 · 정류장 등 일괄 포함)'
    );
    if (confirmed) {
        await downloadBackupZip(versionKey, storeData);
    }
}

/** 서버 종속 데이터 삭제 + 스토어 초기화 (다운로드 없음) */
export async function resetDependentLayers(versionKey: string): Promise<void> {
    try {
        await axiosInstance.delete(`/network/${versionKey}/dependent`);
        useLogStore.getState().addLog('info', '서버 종속 데이터 삭제 완료');
    } catch (e) {
        console.warn('[backupAndReset] 서버 종속 데이터 삭제 실패', e);
        useLogStore.getState().addLog('warn', '서버 종속 데이터 삭제 실패');
    }

    for (const cfg of LAYER_CONFIG) {
        if (cfg.key === 'network') continue;
        cfg.store.getState().resetData();
        (cfg.historyStore.getState() as any).resetAllHistoryStack?.();
    }

    useVehicleStore.setState({ czml: '' as any, vehicleRoute: '' as any, features: '' as any });
    useSimulationStore.getState().reset();
    useSignalTimelineStore.getState().setSignalTimeline([]);
}

/**
 * 네트워크 교체 전에 호출 (기존 호환 유지):
 * 확인 후 백업 ZIP 다운로드 → 종속 데이터 삭제 및 스토어 초기화
 */
export async function backupAndResetDependentLayers(versionKey: string): Promise<void> {
    await confirmAndDownloadBackup(versionKey);
    await resetDependentLayers(versionKey);
}

/**
 * isChanged=true 인 레이어를 versionKey 버전으로 전부 저장한다.
 */
export async function autoSaveChangedLayers(versionKey: string): Promise<void> {
    for (const cfg of LAYER_CONFIG) {
        if (!cfg.store.getState().isChanged) continue;
        const api = apiConfig[cfg.menuCode as ApiMenuKey]?.update;
        if (!api) continue;
        const currentJson = cfg.store.getState().currentJsonData;
        if (!currentJson) continue;

        const mergedLog = mergeUpdateLogs(
            cfg.historyStore.getState().updateLogs,
            cfg.historyStore.getState().snapshotUpdateLogs,
        );
        const data = (cfg as any).fullData
            ? currentJson
            : Object.values(currentJson as Record<string, unknown>)[0];

        try {
            await axiosInstance({
                method: api.method,
                url: api.url + '/' + versionKey,
                data: { data, logs: mergedLog },
            });
            cfg.historyStore.getState().resetUpdateLogs();
            cfg.store.getState().setChange(false);
            useLogStore.getState().addLog('info', `${cfg.label} 자동 저장 완료`);
        } catch (e) {
            useLogStore.getState().addLog('warn', `${cfg.label} 자동 저장 실패 — 내보내기 패널에서 수동 저장하세요`);
            console.warn(`[autoSave] ${cfg.label} 저장 실패`, e);
        }
    }
}
