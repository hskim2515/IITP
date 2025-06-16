import React, {useEffect, useRef, useState} from "react";
import { useSimulationStore } from "@stores/useSimulationStore";
import { FaPlay, FaPause, FaStop, FaFastForward, FaFastBackward } from "react-icons/fa";
import {useCesiumStore} from "@stores/useCesiumStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import {useDebouncedEffect} from "../../hooks/useDebouncedEffect";
import { JulianDate, JulianDate as JD } from "cesium";
import TimelineTrack from "../util/TimelineTrack";


const SimulationControls: React.FC = () => {
    const { speed, setSpeed, start, pause, stop, currentTime} = useSimulationStore();
    const {viewer} = useCesiumStore();

    const [speedState, setSpeedState] = useState(1);

    useDebouncedEffect(() => {
        setSpeed(speedState); // 예: 50km/h → 1x 배속
    }, [speedState], 500); // 300ms 뒤에 반영

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
            setSpeedState(speedState * 2)
        }
    };

    const decreaseSpeed = () => {
        if (viewer) {
            setSpeedState(speedState / 2);
        }
    };

    return (
        <div>
            {currentTime && (
                <div style={styles.simulationControls}>

                    <TimelineTrack/>

                    {/* 감속 버튼 */}
                    <button onClick={decreaseSpeed} style={styles.button} title={`감속 (${speedState}x)`}>
                        <FaFastBackward color="white" />
                        {/*{speedState}x*/}
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
                    <button onClick={increaseSpeed} style={styles.button} title={`배속 (${speedState}x)`}>
                        <FaFastForward color="white" />
                        {/*{speedState}x*/}
                    </button>

                    {speedState}x

                </div>
            )}



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
    timelineContainer: {
        width: "100%",
    },
    slider: {
        width: "100%",
        height: "8px",
        appearance: "none",
        borderRadius: "4px",
        background: "linear-gradient(to right, #00aaff 0%, #0077cc 100%)",
        outline: "none",
        transition: "background 0.3s ease-in-out",
        cursor: "pointer",

        // 크롬 / 엣지
        WebkitAppearance: "none",
        WebkitTransition: "0.2s",

        // 사용자 정의 스타일에 대한 가상 요소는 별도 처리 필요
    }

};

export default SimulationControls;
