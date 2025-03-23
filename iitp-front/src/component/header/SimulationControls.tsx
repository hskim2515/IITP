import React, {useEffect} from "react";
import { useSimulationStore } from "@stores/useSimulationStore";
import { FaPlay, FaPause, FaStop, FaFastForward, FaFastBackward } from "react-icons/fa";
import {useCesiumStore} from "@stores/useCesiumStore";
import { useVehicleStore } from "@stores/useVehicleStore";

const SimulationControls: React.FC = () => {
    const { speed, setSpeed, start, pause, stop } = useSimulationStore();
    const {viewer} = useCesiumStore();

    const numVehicle = useVehicleStore((state) => state.numVehicle);
    const speedFactor = useVehicleStore((state) => state.speedFactor);

    const setSpeedFactor = useVehicleStore((state) => state.setSpeedFactor);
    const setNumVehicle = useVehicleStore((state) => state.setNumVehicle);

    const setStart = () => {
        if (viewer) {
            start();
        }
    };

    const setPause = () => {
        if (viewer) {
            pause();
        }
    };

    const setStop = () => {
        if (viewer) {
            stop();
        }
    };

    const increaseSpeed = () => {
        if (viewer) {
            const multiplierSpeed = speed * 2;
            setSpeed(multiplierSpeed);
        }
    };

    const decreaseSpeed = () => {
        if (viewer) {
            const multiplierSpeed = speed / 2;
            setSpeed(multiplierSpeed);
        }
    };

    return (
        <div style={styles.simulationControls}>

            <div style={{ padding: '10px', borderRadius: '8px', width: '250px' }}>
                <label>시간: {speedFactor.toFixed(5)}</label>
                <input type="range" min="10" max="200" step="10" value={speedFactor} onChange={(e) => setSpeedFactor(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={{ padding: '10px', borderRadius: '8px', width: '250px' }}>
                <label>대수: {numVehicle}</label>
                <input type="range" min="50" max="5000" step="50" value={numVehicle} onChange={(e) => setNumVehicle(Number(e.target.value))} style={{ width: '100%' }} />
            </div>

            {/* 감속 버튼 */}
            <button onClick={decreaseSpeed} style={styles.button} title={`감속 (${speed}x)`}>
                <FaFastBackward color="white" /> {speed}x
            </button>

            {/* 실행 버튼 */}
            <button onClick={setStart} style={styles.button} title="실행">
                <FaPlay color="white" />
            </button>

            {/* 일시정지 버튼 */}
            <button onClick={setPause} style={styles.button} title="일시정지">
                <FaPause color="white" />
            </button>

            {/* 정지 버튼 */}
            <button onClick={setStop} style={styles.button} title="정지">
                <FaStop color="white" />
            </button>

            {/* 배속 버튼 */}
            <button onClick={increaseSpeed} style={styles.button} title={`배속 (${speed}x)`}>
                <FaFastForward color="white" /> {speed}x
            </button>
        </div>
    );
};

// 스타일 정의
const styles = {
    simulationControls: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    button: {
        backgroundColor: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: "18px",
    },
};

export default SimulationControls;
