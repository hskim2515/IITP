/**
 * NextSim 실행 파이프라인 단계 — 백엔드 SimulationController.classifyStep() 이 반환하는
 * stepKey 와 1:1 대응하는 단일 소스. 순서가 실제 실행 순서(NextSimRunner.stageInputs/run)와 같다.
 */
export const NEXTSIM_PHASES: { key: string; label: string }[] = [
    { key: "STAGING", label: "입력 확인" },
    { key: "VALIDATING", label: "정합성 보정" },
    { key: "ROUTE_GEN", label: "경로 생성" },
    { key: "SIMULATION", label: "시뮬레이션 실행" },
    { key: "SAVING", label: "결과 저장" },
];
