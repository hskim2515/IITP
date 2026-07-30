import axiosInstance from "@api/axiosInstance";
import { useSignalStore } from "@stores/useSignalStore";
import { usePavementMarkingStore } from "@stores/usePavementMarkingStore";
import { useNextSimReadinessStore } from "@stores/useNextSimReadinessStore";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { useLogStore } from "@stores/useLogStore";
import { assignPropertyToResponseData } from "@utils/guid";
import { generateDummySignals } from "@utils/signal";
import { generateDummyPavementMarkings } from "@utils/pavementMarking";
import { getNetworkForDummyGeneration } from "@utils/generationNetwork";
import { autoSaveChangedLayers } from "@utils/autoSave";
import { getActiveVersionId } from "@utils/versionId";
import { refetchSignalAndTod } from "@utils/ktdbScaffold";
import { useAppSettingsStore } from "@stores/useAppSettingsStore";

/**
 * 더미 신호 생성 + 저장 + signalTOD 정합(repair-tod) 을 한 곳에 묶은 공용 함수.
 *
 * ⚠️ signal.xml 을 통째로 덮어쓰는 저장이라, KTDB 배경 스캐폴딩이 만들어둔(또는 이전 호출이
 * 만들어둔) signalTOD.xml 과 노드 집합이 어긋날 수 있다 — 저장 직후 항상 repair-tod 로
 * 재동기화한다(과거 실측: 노드 18,486건 불일치로 NextSim 크래시). 이 함수를 호출하는 모든
 * 곳(온보딩 자동 생성, 가져오기 후 자동 생성)이 이 정합을 빠짐없이 거치게 하기 위해
 * App.tsx/FileImportModal.tsx 각각에 흩어져 있던 동일 로직을 여기로 모았다.
 *
 * @returns 생성된 신호 개수 (0 이면 대상 없음/네트워크 없음)
 */
export async function generateAndSaveDummySignal(): Promise<number> {
    const network = await getNetworkForDummyGeneration();
    if (!network?.nodes?.length) return 0;

    const signals = await generateDummySignals(network);
    if (signals.length === 0) return 0;

    const signalData = { signals };
    assignPropertyToResponseData(signalData);
    useSignalStore.getState().setCurrentJsonData(signalData);
    useSignalStore.getState().setChange(true);

    const versionKey = getActiveVersionId();
    if (versionKey) {
        await autoSaveChangedLayers(versionKey);
        try {
            await axiosInstance.post(`/signal/${encodeURIComponent(versionKey)}/repair-tod`);
            await refetchSignalAndTod(versionKey);
        } catch (e) {
            console.warn("[dummyGeneration] signalTOD 정합 실패(무시):", e);
        }
        useNextSimReadinessStore.getState().runAll();
    }
    return signals.length;
}

/** 더미 노면표시 생성 + 저장. 노면표시는 다른 파일과 짝 맞출 필요가 없어 정합 후처리가 없다. */
export async function generateAndSaveDummyPavementMarking(): Promise<number> {
    const network = await getNetworkForDummyGeneration();
    if (!network?.nodes?.length) return 0;

    const pavementMarkings = generateDummyPavementMarkings(network);
    if (pavementMarkings.length === 0) return 0;

    const pavementMarkingData = { pavementMarkings };
    assignPropertyToResponseData(pavementMarkingData);
    usePavementMarkingStore.getState().setCurrentJsonData(pavementMarkingData);
    usePavementMarkingStore.getState().setChange(true);

    const versionKey = getActiveVersionId();
    if (versionKey) await autoSaveChangedLayers(versionKey);
    return pavementMarkings.length;
}

const TASK_KEY = "dummy-gen";
let running = false;

/**
 * "네트워크는 있는데 신호가 없다" 상황에서 사용자에게 버튼을 눌러달라고 요구하는 대신,
 * 필요한 시점에 자동으로 신호+노면표시 더미를 만들어 저장한다(온보딩 위저드/가져오기 완료
 * 콜백에서 호출). KTDB 대형망은 신호/OD/TOD를 백엔드가 이미 자체적으로 스캐폴딩하므로
 * 이 함수 전체를 호출하지 않는다(호출부에서 그 경로는 건너뜀 — KtdbImportController 참고).
 * ⚠️ 단, 노면표시는 백엔드 스캐폴딩 대상이 아니라서(시각화 보조 자료, NextSim 입력 아님)
 * KTDB 경로도 노면표시만은 FileImportModal.tsx에서 이 함수 대신 generateAndSaveDummyPavementMarking을
 * 직접 호출해 재생성한다 — 과거엔 이 사실을 놓쳐 KTDB 재임포트마다 노면표시가 계속 비는
 * 버그가 있었다.
 *
 * 지도 상단에 KTDB 배경 스캐폴딩과 동일한 방식(useBackgroundTaskStore)으로 진행 스피너를
 * 띄운다 — 완전히 조용하면 "언제 끝났는지" 알 길이 없어서다. 동시 중복 실행은 모듈 전역
 * `running` 플래그로 차단(같은 화면에서 여러 트리거가 겹칠 수 있음 — 예: 자동 트리거와
 * 다른 가져오기가 동시에 끝나는 경우).
 */
export async function runAutoDummyGeneration(): Promise<void> {
    if (running) return;
    running = true;
    useBackgroundTaskStore.getState().setTask(TASK_KEY, "신호/노면표시 데이터 자동 생성 중...");
    try {
        const sigCount = await generateAndSaveDummySignal();
        // 앱 설정(⚙ → 자동생성 설정)에서 끄면 노면표시는 생성하지 않는다 — 신호는 이 토글
        // 대상이 아님(NextSim 실행에 필수라 항상 생성, 노면표시는 시각화 보조 자료라 선택적).
        const pavementMarkingEnabled = useAppSettingsStore.getState().autoGeneration.pavementMarkingEnabled;
        const pmCount = pavementMarkingEnabled ? await generateAndSaveDummyPavementMarking() : 0;
        if (sigCount > 0 || pmCount > 0) {
            useLogStore.getState().addLog(
                "info", `신호/노면표시 데이터 자동 생성 완료 (신호 ${sigCount}개, 노면표시 ${pmCount}개)`,
            );
        }
    } catch (e) {
        useLogStore.getState().addLog("warn", `신호/노면표시 자동 생성 실패: ${e}`);
    } finally {
        useBackgroundTaskStore.getState().setTask(TASK_KEY, null);
        running = false;
    }
}
