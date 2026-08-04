import React, { useState } from "react";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import { FaPlay, FaPause, FaStop, FaFastForward, FaFastBackward } from "react-icons/fa";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useDebouncedEffect } from "../../hooks/useDebouncedEffect";
import styles from "@css/Header.module.css";

const SimulationControls: React.FC = () => {
    const { speed, setSpeed, start, pause, stop, currentTime } = useSimulationStore();
    const { viewer } = useCesiumStore();
    const viewportVehicleInfo = useVehicleStore((state) => (state as any).viewportVehicleInfo);
    const [speedState, setSpeedState] = useState(1);

    useDebouncedEffect(() => {
        setSpeed(speedState);
    }, [speedState], 500);

    const setStart  = () => { if (viewer) start(); };
    const setPause  = () => { if (viewer) pause(); };
    const setStop   = () => { if (viewer) stop(); };
    const increaseSpeed = () => { if (viewer) setSpeedState(s => s * 2); };
    const decreaseSpeed = () => { if (viewer) setSpeedState(s => s / 2); };

    if (!currentTime) return null;
    // ⚠️ viewport 스트리밍(상시 타일 모드 기본 경로)에서는 카메라가 아직 올바른 위치(네트워크
    // extent)에 도착하기 전, 잘못된 기본 카메라 위치 기준으로 첫 응답이 와서 clock(currentTime)만
    // 먼저 설정되고 차량은 0대인 순간이 있다(실사용 보고 — 재생바가 먼저 뜨는데 정작 차량은 아직
    // 안 보임). viewportVehicleInfo가 있는(=viewport 스트리밍 사용 중인) 경우엔 실제로 차량을
    // 최소 1대 이상 받은 뒤에만 재생 컨트롤을 보여준다. viewportVehicleInfo가 없으면(전체 CZML
    // 경로) 이 판단 대상이 아니므로 기존처럼 currentTime만으로 표시한다.
    if (viewportVehicleInfo && viewportVehicleInfo.total === 0 && !viewportVehicleInfo.dense) return null;

    return (
        <div className={styles.simBar}>
            <button className={styles.simBtn} onClick={decreaseSpeed} title={`감속 (${speedState}x)`}>
                <FaFastBackward size={10} />
            </button>

            <button className={`${styles.simBtn} ${styles.simBtnPlay}`} onClick={setStart} title="실행">
                <FaPlay size={10} />
            </button>

            <button className={styles.simBtn} onClick={setPause} title="일시정지">
                <FaPause size={10} />
            </button>

            <button className={styles.simBtn} onClick={setStop} title="정지">
                <FaStop size={10} />
            </button>

            <button className={styles.simBtn} onClick={increaseSpeed} title={`배속 (${speedState}x)`}>
                <FaFastForward size={10} />
            </button>

            <span className={styles.simSpeed}>{speedState}x</span>
        </div>
    );
};

export default SimulationControls;
