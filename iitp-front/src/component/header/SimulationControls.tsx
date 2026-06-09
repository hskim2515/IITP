import React, { useEffect, useState } from "react";
import { useSimulationStore } from "@stores/useSimulationStore";
import { FaPlay, FaPause, FaStop, FaFastForward, FaFastBackward } from "react-icons/fa";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useDebouncedEffect } from "../../hooks/useDebouncedEffect";
import TimelineTrack from "../util/TimelineTrack";
import styles from "@css/Header.module.css";
import { JulianDate } from "cesium";

const formatDuration = (seconds: number): string => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
};

const SimulationControls: React.FC = () => {
    const { isRunning, speed, setSpeed, start, pause, stop, startTime, endTime, currentTime, setCurrentTime } = useSimulationStore();
    const { viewer } = useCesiumStore();
    const [speedState, setSpeedState] = useState(1);

    useDebouncedEffect(() => {
        setSpeed(speedState);
    }, [speedState], 500);

    const setStart  = () => {
        if (!viewer) return;
        if (startTime && endTime && currentTime && JulianDate.secondsDifference(currentTime, endTime) >= -0.001) {
            viewer.clock.currentTime = JulianDate.clone(startTime);
            setCurrentTime(JulianDate.clone(startTime));
        }
        start();
    };
    const setPause  = () => { if (viewer) pause(); };
    const setStop   = () => { if (viewer) stop(); };
    const increaseSpeed = () => { if (viewer) setSpeedState(s => s * 2); };
    const decreaseSpeed = () => { if (viewer) setSpeedState(s => Math.max(0.25, s / 2)); };

    const jumpTime = (seconds: number) => {
        if (!viewer || !startTime || !endTime) return;

        const next = JulianDate.addSeconds(viewer.clock.currentTime, seconds, new JulianDate());
        const clamped = JulianDate.lessThan(next, startTime)
            ? JulianDate.clone(startTime)
            : JulianDate.greaterThan(next, endTime)
                ? JulianDate.clone(endTime)
                : next;

        viewer.clock.currentTime = clamped;
        setCurrentTime(JulianDate.clone(clamped));
        viewer.scene.requestRender();
    };

    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            const tagName = target.tagName.toLowerCase();
            return (
                tagName === "input" ||
                tagName === "textarea" ||
                tagName === "select" ||
                tagName === "button" ||
                target.isContentEditable
            );
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (isTypingTarget(event.target)) return;
            if (!viewer || !currentTime) return;

            if (event.code === "Space") {
                if (event.repeat) return;
                event.preventDefault();
                if (isRunning) {
                    pause();
                } else {
                    start();
                }
                return;
            }

            if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
                event.preventDefault();
                const step = event.shiftKey ? 60 : 10;
                jumpTime(event.code === "ArrowLeft" ? -step : step);
                return;
            }

            if (event.code === "ArrowUp" || event.code === "ArrowDown") {
                event.preventDefault();
                if (event.code === "ArrowUp") {
                    increaseSpeed();
                } else {
                    decreaseSpeed();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [viewer, startTime, endTime, currentTime, isRunning, start, pause, setCurrentTime]);

    const isEnded = !!(currentTime && endTime && JulianDate.secondsDifference(currentTime, endTime) >= -0.001);

    useEffect(() => {
        if (!viewer || !isRunning || !isEnded) return;
        viewer.clock.shouldAnimate = false;
        pause();
    }, [viewer, isRunning, isEnded, pause]);

    if (!currentTime) return null;

    const elapsedSeconds = startTime ? JulianDate.secondsDifference(currentTime, startTime) : 0;
    const totalSeconds = startTime && endTime ? JulianDate.secondsDifference(endTime, startTime) : 0;
    const statusLabel = isEnded ? "종료" : isRunning ? "실행 중" : "일시정지";
    const statusClass = isEnded
        ? styles.simStateGroupEnded
        : isRunning
            ? styles.simStateGroupRunning
            : styles.simStateGroupPaused;

    return (
        <div className={styles.simBar}>
            <TimelineTrack />

            <div className={styles.simDivider} />

            <div className={`${styles.simStateGroup} ${statusClass}`}>
                <div className={styles.simStatus}>
                    <span className={styles.simStatusDot} />
                    {statusLabel}
                </div>
                <div className={styles.simTime} title="현재 시간 / 전체 시간">
                    {formatDuration(elapsedSeconds)}
                    <span className={styles.simTimeSep}>/</span>
                    {formatDuration(totalSeconds)}
                </div>
            </div>

            <button className={styles.simBtn} onClick={decreaseSpeed} title={`감속 (${speedState}x)`}>
                <FaFastBackward size={10} />
            </button>

            <button className={`${styles.simBtn} ${styles.simBtnPlay} ${isRunning ? styles.simBtnActive : ''}`} onClick={setStart} title="실행 (Space)">
                <FaPlay size={10} />
            </button>

            <button className={`${styles.simBtn} ${!isRunning && !isEnded ? styles.simBtnActive : ''}`} onClick={setPause} title="일시정지 (Space)">
                <FaPause size={10} />
            </button>

            <button className={styles.simBtn} onClick={setStop} title="정지">
                <FaStop size={10} />
            </button>

            <button className={styles.simBtn} onClick={increaseSpeed} title={`배속 (${speedState}x)`}>
                <FaFastForward size={10} />
            </button>

            <span className={styles.simSpeed} title="←/→ 10초 이동, Shift+←/→ 60초 이동, ↑/↓ 배속 조절">{speedState}x</span>
        </div>
    );
};

export default SimulationControls;
