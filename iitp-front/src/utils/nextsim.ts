import { create } from "zustand";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import { useLogStore } from "@stores/useLogStore";

/**
 * NextSim 실행 클라이언트 — 실행/폴링/취소/재개를 컴포넌트 생명주기와 분리.
 *
 * 시뮬은 서버에서 돌므로(45분+ 가능) 탭을 닫거나 모달이 언마운트돼도 계속된다.
 * 폴링 상태를 모듈 전역(store)에 두어 ① 모달이 다시 열리면 진행 상태를 그대로 표시,
 * ② 시나리오 재진입 시 RUNNING 이면 폴링을 자동 복원한다.
 */
interface NextSimRunState {
    /** 러너 설정 여부 (null=미확인) — 버튼 노출 판단 */
    available: boolean | null;
    /** 현재 폴링 중인 versionId (null=없음) */
    runningVersionId: string | null;
    /** 서버에 진행 중인 실행이 있는지 확인하는 중(resumeNextSimPollingIfRunning) — 이 확인이
     *  끝나기 전엔 실제로는 RUNNING인데 runningVersionId가 아직 null일 수 있어, 그 짧은 레이스
     *  윈도우 동안 "실행" 버튼이 눌리는 걸 막는 데만 쓴다(백엔드 409로도 안전하지만 UI에서도 닫음). */
    checking: boolean;
    stage: string;
    /** 체크리스트 표시용 분류된 단계 키 — NEXTSIM_PHASES 의 key 와 대응 (nextsimPhases.ts) */
    stepKey: string;
    /** 실행 경과 초 (status API elapsedSeconds) */
    elapsedSeconds: number;
    /** 마지막 시뮬레이터 출력 후 경과 초 — 하트비트 (연산 중 여부 판단) */
    sinceOutputSeconds: number;
    /** 직전 같은 버전 성공 실행 이력 기준 진행률(0~99) — 이력 없으면(첫 실행) null */
    progressPercent: number | null;
    /** 위 이력 기준 예상 잔여 초 — progressPercent 와 함께 null 여부가 같이 간다 */
    etaSeconds: number | null;
    /** 마지막 실행 실패 메시지 — 모달 등 UI 표면화용 (새 실행 시작 시 초기화) */
    lastError: string | null;
    setAvailable: (v: boolean) => void;
    setRunning: (versionId: string | null, stage?: string) => void;
    setProgress: (
        stage: string, stepKey: string, elapsedSeconds: number, sinceOutputSeconds: number,
        progressPercent: number | null, etaSeconds: number | null,
    ) => void;
    setLastError: (msg: string | null) => void;
}

export const useNextSimRunStore = create<NextSimRunState>((set) => ({
    available: null,
    runningVersionId: null,
    checking: false,
    stage: "",
    stepKey: "STAGING",
    elapsedSeconds: 0,
    sinceOutputSeconds: 0,
    progressPercent: null,
    etaSeconds: null,
    lastError: null,
    setAvailable: (v) => set({ available: v }),
    setRunning: (versionId, stage) =>
        set({
            runningVersionId: versionId, stage: stage ?? "", stepKey: "STAGING",
            elapsedSeconds: 0, sinceOutputSeconds: 0, progressPercent: null, etaSeconds: null,
        }),
    setProgress: (stage, stepKey, elapsedSeconds, sinceOutputSeconds, progressPercent, etaSeconds) =>
        set({ stage, stepKey, elapsedSeconds, sinceOutputSeconds, progressPercent, etaSeconds }),
    setLastError: (msg) => set({ lastError: msg }),
}));

/** 경과 초 → "N분 M초" 표시 (모달/패널 공용) */
export const formatElapsed = (sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;

/** ETA 초 → "약 N분 M초" 표시 (formatElapsed 와 동일 포맷, 문구만 다름) */
export const formatEta = (sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;

const BASE = () => import.meta.env.VITE_API_URL;
const setTask = (label: string | null) =>
    useBackgroundTaskStore.getState().setTask("nextsim-run", label);
const log = (level: "info" | "warn" | "error", text: string) =>
    useLogStore.getState().addLog(level, text);

/** 러너 설정 여부 확인 (1회 캐시) */
export async function checkNextSimAvailable(): Promise<boolean> {
    const cur = useNextSimRunStore.getState().available;
    if (cur !== null) return cur;
    try {
        const r = await fetch(`${BASE()}/simulation/available`);
        const b = r.ok ? await r.json() : { available: false };
        useNextSimRunStore.getState().setAvailable(!!b?.available);
        return !!b?.available;
    } catch {
        useNextSimRunStore.getState().setAvailable(false);
        return false;
    }
}

/** 실행 시작 + 폴링. 이미 실행 중(409)이면 폴링만 붙는다. */
export async function startNextSimRun(versionId: string): Promise<void> {
    log("info", "[NextSim] 시뮬레이션 실행 시작...");
    useNextSimRunStore.getState().setLastError(null);
    try {
        const res = await fetch(`${BASE()}/simulation/${versionId}/run`, { method: "POST" });
        if (res.status !== 202 && res.status !== 409) {
            const body: any = await res.json().catch(() => ({}));
            throw new Error(body?.message ?? `서버 오류 (${res.status})`);
        }
        startPolling(versionId);
    } catch (e: any) {
        const msg = `실행 요청 실패: ${e?.message ?? e}`;
        log("error", `[NextSim] ${msg}`);
        useNextSimRunStore.getState().setLastError(msg);
        setTask(null);
    }
}

/** 실행 취소 요청 — 상태 마감(CANCELLED)은 폴링이 수신 */
export async function cancelNextSimRun(versionId: string): Promise<void> {
    try {
        const res = await fetch(`${BASE()}/simulation/${versionId}/run`, { method: "DELETE" });
        if (!res.ok) {
            const body: any = await res.json().catch(() => ({}));
            log("warn", `[NextSim] 취소 실패: ${body?.message ?? res.status}`);
            return;
        }
        log("info", "[NextSim] 취소 요청됨 — 정리 중...");
    } catch (e: any) {
        log("error", `[NextSim] 취소 요청 오류: ${e?.message ?? e}`);
    }
}

/**
 * 시나리오 진입 시 호출 — 서버에 진행 중인 실행이 있으면 폴링 복원.
 * (탭 리로드/재접속 후에도 진행 상황과 완료 시 차량 로드가 이어진다)
 */
export async function resumeNextSimPollingIfRunning(versionId: string): Promise<void> {
    if (!versionId) return;
    if (useNextSimRunStore.getState().runningVersionId === versionId) return; // 이미 폴링 중
    useNextSimRunStore.setState({ checking: true });
    try {
        const r = await fetch(`${BASE()}/simulation/${versionId}/status`);
        if (!r.ok) return;
        const s: any = await r.json();
        if (s?.state === "RUNNING") {
            log("info", "[NextSim] 진행 중인 시뮬레이션 발견 — 상태 표시를 복원합니다");
            startPolling(versionId);
        }
    } catch { /* 서버 미가용 등 — 조용히 무시 */ }
    finally {
        useNextSimRunStore.setState({ checking: false });
    }
}

function startPolling(versionId: string): void {
    const store = useNextSimRunStore.getState();
    if (store.runningVersionId === versionId) return; // 중복 폴링 방지
    store.setRunning(versionId, "시작 중...");

    const poll = (n: number) => {
        // 다른 버전으로 전환 등으로 폴링 소유권을 잃었으면 중단
        if (useNextSimRunStore.getState().runningVersionId !== versionId) return;
        fetch(`${BASE()}/simulation/${versionId}/status`)
            .then((r) => r.json())
            .then((s: any) => {
                if (s.state === "RUNNING") {
                    const beat = s.sinceOutputSeconds > 10 ? ` · 마지막 출력 ${s.sinceOutputSeconds}초 전 (연산 중)` : "";
                    const label = `NextSim 실행 중 — ${s.stage ?? ""} (${s.elapsedSeconds ?? 0}초${beat})`;
                    useNextSimRunStore.getState().setProgress(
                        s.stage ?? "", s.stepKey ?? "STAGING", s.elapsedSeconds ?? 0, s.sinceOutputSeconds ?? 0,
                        s.progressPercent ?? null, s.etaSeconds ?? null);
                    setTask(label);
                    if (n < 4800) setTimeout(() => poll(n + 1), 3000);
                    else finish("warn", "[NextSim] 상태 폴링 시간 초과 — 상태 조회로 확인하세요");
                } else if (s.state === "DONE") {
                    finish("info", "[NextSim] 시뮬레이션 완료 — 결과를 불러옵니다...");
                    useVehicleStore.getState().triggerRefetch();
                } else if (s.state === "CANCELLED") {
                    finish("info", "[NextSim] 실행이 취소되었습니다");
                } else if (s.state === "ERROR") {
                    const msg = `실행 실패: ${s.error ?? "알 수 없는 오류"}`;
                    useNextSimRunStore.getState().setLastError(msg);
                    finish("error", `[NextSim] ${msg}`);
                } else { // IDLE — 서버 재시작 등
                    finish("warn", "[NextSim] 실행 상태를 찾을 수 없습니다 (서버 재시작?)");
                }
            })
            .catch(() => {
                if (n < 4800) setTimeout(() => poll(n + 1), 5000);
                else finish("warn", "[NextSim] 상태 폴링 중단 (서버 미응답)");
            });
    };
    const finish = (level: "info" | "warn" | "error", msg: string) => {
        setTask(null);
        useNextSimRunStore.getState().setRunning(null);
        log(level, msg);
    };
    poll(0);
}
