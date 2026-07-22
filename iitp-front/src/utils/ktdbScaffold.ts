import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { useLogStore } from "@stores/useLogStore";
import { useMessageStore } from "@stores/useMessageStore";
import { useNextSimReadinessStore } from "@stores/useNextSimReadinessStore";
import { useSignalStore } from "@stores/useSignalStore";
import { useSignalTodStore } from "@stores/useSignalTodStore";
import { assignPropertyToResponseData } from "@utils/guid";
import { refreshNetworkTiles } from "@utils/networkRefresh";

// 스캐폴딩 완료 시점에 signal/signalTod 스토어를 서버에서 다시 받아온다 — 임포트 직후
// 프론트가 채워둔 값은 백엔드 CompletableFuture.runAsync가 아직 신호/TOD를 재생성하기
// 전의 스냅샷(대형망은 아예 비어있는 간소화 응답)이라, 여기서 refetch하지 않으면
// "새로고침해야만 정상으로 보이는" 상태로 영원히 남는다(실측 증상).
async function refetchSignalAndTod(versionId: string): Promise<void> {
    const base = import.meta.env.VITE_API_URL;
    try {
        const [signalRes, todRes] = await Promise.all([
            fetch(`${base}/signal/${encodeURIComponent(versionId)}`),
            fetch(`${base}/signal-tod/${encodeURIComponent(versionId)}`),
        ]);
        if (signalRes.ok) {
            const data = await signalRes.json();
            assignPropertyToResponseData(data);
            useSignalStore.getState().setOriginData(data);
            useSignalStore.getState().setCurrentJsonData(data);
        }
        if (todRes.ok) {
            const data = await todRes.json();
            assignPropertyToResponseData(data);
            useSignalTodStore.getState().setOriginData(data);
            useSignalTodStore.getState().setCurrentJsonData(data);
        }
    } catch (e) {
        console.error("[ktdbScaffold] 신호/TOD 재조회 실패", e);
    }
}

/**
 * KTDB 가져오기 응답은 백그라운드 스캐폴딩(더미 신호/OD/TOD 생성 + 타일 재빌드,
 * KtdbImportController 의 CompletableFuture.runAsync)을 기다리지 않고 먼저 돌아온다.
 * 대형망은 이 작업만 수십 초~수 분 걸릴 수 있는데, 지금까지는 완료 여부를 프론트가 알
 * 방법이 없어 "가져오기 완료"로 보이는 시점과 실제 더미 데이터가 준비되는 시점이 어긋났다
 * (실측: "아무리 기다려도 안 생기네" — 배경 작업이 끝나기 전에 재임포트/더미 재생성을
 * 다시 눌러 중복 작업이 겹칠 수 있었다).
 *
 * GET /network/import/ktdb/status 를 폴링해 진행 중이면 지도 상단 스피너(useBackgroundTaskStore,
 * NextSim 실행/차량 경로 생성과 동일 패턴)로 노출하고, 완료되면 타일을 다시 갱신하고
 * NextSim 준비 상태 검증을 무효화한다(백그라운드에서 signal.xml/OD 가 방금 바뀌었으므로).
 */
const TASK_KEY = "ktdb-scaffold";
const setTask = (label: string | null) => useBackgroundTaskStore.getState().setTask(TASK_KEY, label);

export function pollKtdbScaffoldStatus(versionId: string, retryCount = 0): void {
    if (!versionId) return;
    const base = import.meta.env.VITE_API_URL;

    fetch(`${base}/network/import/ktdb/status?versionId=${encodeURIComponent(versionId)}`)
        .then(res => res.ok ? res.json() : null)
        .then((body: { inProgress?: boolean; warning?: string } | null) => {
            if (!body?.inProgress) {
                // retryCount===0(첫 폴링)에도 항상 완료 처리한다 — 이 함수는 실제 KTDB 임포트
                // 직후에만 호출되므로(FileImportModal.handleConfirm) "진행 중이었던 적이 없으면
                // 스킵"은 성립하지 않는다: 스캐폴딩이 아주 빨리 끝나면 첫 폴링부터 이미
                // inProgress=false일 수 있는데, 예전엔 이 경우를 "원래 아무 일도 없었음"으로
                // 오판해 refetch/재검증을 건너뛰어 스토어가 임포트 직후 스냅샷에 그대로
                // 남았다(실측: 새로고침해야만 정상으로 보이던 증상의 진짜 원인).
                setTask(null);
                useLogStore.getState().addLog("info", "백그라운드 더미 데이터(신호/OD/TOD) 생성 완료");
                refreshNetworkTiles();
                // signal/signalTod 스토어를 서버 최신값으로 갱신한 뒤 검증을 다시 돌린다 —
                // invalidate()만 하면 배지가 "미확인"으로만 바뀌고 스토어는 여전히 임포트
                // 직후의(백엔드 재생성 전) 값이라, 사용자가 새로고침해야만 정상으로 보였다.
                refetchSignalAndTod(versionId).finally(() => {
                    useNextSimReadinessStore.getState().runAll();
                });
                // 재임포트로 링크/노드 id 가 바뀌어 기존 버스 노선이 안 맞을 수 있음 — 자동으로
                // 고칠 방법이 없는 연쇄(노선 재작성은 사용자 판단 필요)라 조용히 넘기지 않고
                // 팝업으로 알린다.
                if (body?.warning) {
                    useMessageStore.getState().setMessage({ type: "warn", text: body.warning });
                }
                return;
            }
            setTask("백그라운드에서 더미 신호/OD/TOD 데이터 생성 중...");
            if (retryCount < 600) {
                setTimeout(() => pollKtdbScaffoldStatus(versionId, retryCount + 1), retryCount < 10 ? 2000 : 5000);
            } else {
                setTask(null); // 대기 시간 초과 — 스피너만 해제, 실제 작업은 서버에서 계속됨
            }
        })
        .catch(() => setTask(null));
}
