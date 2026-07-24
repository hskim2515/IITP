import { apiConfig, ApiMenuKey } from '@config/apiConfig';
import axiosInstance from '@api/axiosInstance';
import { mergeUpdateLogs } from '@utils/history';
import { useMessageStore } from '@stores/useMessageStore';
import { LAYER_CONFIG } from '@component/tool/DataIOPanel';

type LayerCfg = (typeof LAYER_CONFIG)[number];

/** LAYER_CONFIG 아무 레이어라도 저장 안 된 편집이 있는지 — 헤더의 미저장 배지/편집모드
 *  이탈 확인과 DataIOPanel 저장 배지가 동일 기준을 쓰도록 한 곳에 둔다. */
export function hasUnsavedLayerChanges(): boolean {
    return LAYER_CONFIG.some(cfg => cfg.store.getState().isChanged);
}

/** 레이어 하나를 서버에 저장 — DataIOPanel.doSaveLayer 와 동일 로직이되, 패널 전용 로컬
 *  상태(savingKeys/importStatus) 대신 전역 토스트로 결과를 알린다(패널 밖에서도 호출되므로).
 *  실패 시 throw — 호출측(SaveVersionModal)이 유령 버전 롤백에 이 실패를 이용한다. */
export async function saveLayer(cfg: LayerCfg, versionKey: string): Promise<void> {
    if (cfg.key === 'network') {
        try {
            const { saveNetworkDiffTileAware } = await import('@utils/networkDiff');
            const result = await saveNetworkDiffTileAware(versionKey);
            if (result === 'skipped') throw new Error(`${cfg.label} diff 저장 불가 — 데이터 없음`);
            cfg.historyStore.getState().resetUpdateLogs();
            useMessageStore.getState().setMessage({ type: 'info', text: `${cfg.label} 저장 완료 (diff)` });
        } catch (e) {
            useMessageStore.getState().setMessage({ type: 'error', text: `${cfg.label} 저장 실패` });
            throw e;
        }
        return;
    }
    const api = apiConfig[cfg.menuCode as ApiMenuKey]?.update;
    if (!api) return;
    const currentJson = cfg.store.getState().currentJsonData;
    if (!currentJson) return;
    const logJson = cfg.historyStore.getState().updateLogs;
    const snapshotLogJson = cfg.historyStore.getState().snapshotUpdateLogs;
    const mergedLog = mergeUpdateLogs(logJson, snapshotLogJson);
    const data = cfg.fullData
        ? currentJson
        : Object.values(currentJson as Record<string, unknown>)[0];
    try {
        await axiosInstance({ method: api.method, url: api.url + '/' + versionKey, data: { data, logs: mergedLog } });
        cfg.historyStore.getState().resetUpdateLogs();
        cfg.store.getState().setChange(false);
        useMessageStore.getState().setMessage({ type: 'info', text: `${cfg.label} 저장 완료` });
    } catch (e) {
        useMessageStore.getState().setMessage({ type: 'error', text: `${cfg.label} 저장 실패` });
        throw e;
    }
}

/** 변경된 레이어 전부를 순서대로 저장. 하나라도 실패하면 그 자리에서 throw하고 멈춘다
 *  (나머지는 시도하지 않음 — 부분 저장 상태를 성공처럼 보이게 하지 않기 위해). */
export async function saveAllChangedLayers(versionKey: string): Promise<void> {
    const changed = LAYER_CONFIG.filter(cfg => cfg.store.getState().isChanged);
    for (const cfg of changed) await saveLayer(cfg, versionKey);
}
