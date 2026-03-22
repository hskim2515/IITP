import React, { useState } from "react";
import { useSimulationStore } from "@stores/useSimulationStore";
import { FaPlay, FaPause, FaStop, FaFastForward, FaFastBackward } from "react-icons/fa";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useDebouncedEffect } from "../../hooks/useDebouncedEffect";
import TimelineTrack from "../util/TimelineTrack";
import styles from "@css/Header.module.css";

const SimulationControls: React.FC = () => {
    const { speed, setSpeed, start, pause, stop, currentTime } = useSimulationStore();
    const { viewer } = useCesiumStore();
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

    return (
        <div className={styles.simBar}>
            <TimelineTrack />

            <div className={styles.simDivider} />

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
