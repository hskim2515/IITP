import React, {useEffect, useRef, useState} from "react";
import '../../App.css'
import {JulianDate} from "cesium";
import {useCesiumStore} from "@stores/useCesiumStore";
import {useSimulationStore} from "@stores/useSimulationStore";



export default function TimelineTrack() {

    const {viewer} = useCesiumStore();

    const [sliderValue, setSliderValue] = useState(0); // 0~100%
    const [isDragging, setIsDragging] = useState(false);

    const { startTime, endTime } = useSimulationStore();


    const blockWidth = 1; // 1프레임 = 2px
    const minFrame = 0;
    const maxFrame = endTime?.secondsOfDay - startTime?.secondsOfDay;

    const [active, setActive] = useState({ start: 0, end: endTime?.secondsOfDay - startTime?.secondsOfDay });

    const [jump, setJump] = useState<{ start: number; end: number } | null>({
        start: 60,
        end: 200,
    });
    const [jumpHovered, setJumpHovered] = useState(false);
    const [activeHovered, setActiveHovered] = useState(false);

    const resizing = useRef<null | { block: "active" | "jump"; side: "left" | "right" }>(null);
    const dragOffset = useRef<number>(0); // 마우스와 블록 사이 오프셋
    const trackRef = useRef<HTMLDivElement>(null);

    const [range, setRangeValue] = useState((active.end - active.start )/50); // 0~100%

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging || !trackRef.current) return;

            const rect = trackRef.current.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
            const percent = (x / rect.width) * 100;
            setSliderValue(percent);

            if (viewer) {
                const { clock } = viewer;

                const totalSeconds = JulianDate.secondsDifference(endTime, startTime);
                const newTime = JulianDate.addSeconds(
                    startTime,
                    (totalSeconds * percent) / 100,
                    new JulianDate()
                );
                clock.currentTime = newTime;
            }
        };

        const onMouseUp = () => {
            setIsDragging(false);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [isDragging, viewer]);

    useEffect(() => {
        if (!viewer || !active || active.start == null || active.end == null) return;

        const clock = viewer.clock;

        const updateSlider = () => {
            if (isDragging) return;

            const total = JulianDate.secondsDifference(clock.stopTime, clock.startTime);
            let elapsed = JulianDate.secondsDifference(clock.currentTime, clock.startTime);

            // 현재 프레임 계산
            let currentFrame = Math.floor(elapsed * (maxFrame - minFrame) / total);

            // [1] jump 구간을 건너뜀
            if (jump && currentFrame >= jump.start && currentFrame < jump.end) {
                const jumpEndTime = JulianDate.addSeconds(
                    clock.startTime,
                    (jump.end / (maxFrame - minFrame)) * total,
                    new JulianDate()
                );
                clock.currentTime = jumpEndTime;
                elapsed = JulianDate.secondsDifference(jumpEndTime, clock.startTime);
                currentFrame = Math.floor(elapsed * (maxFrame - minFrame) / total);
            }

            // [2] active 구간 바깥이면 active.start로 점프
            if (currentFrame < active.start || currentFrame > active.end) {
                const activeStartTime = JulianDate.addSeconds(
                    clock.startTime,
                    (active.start / (maxFrame - minFrame)) * total,
                    new JulianDate()
                );
                clock.currentTime = activeStartTime;
                elapsed = JulianDate.secondsDifference(activeStartTime, clock.startTime);
                currentFrame = active.start;
            }

            // [3] 슬라이더 값 업데이트
            const percentage = (elapsed / total) * 100;
            setSliderValue(Math.min(Math.max(percentage, 0), 100));
        };

        viewer.clock.onTick.addEventListener(updateSlider);
        return () => viewer.clock.onTick.removeEventListener(updateSlider);
    }, [viewer, isDragging, jump, active]);


    const handleMouseDown = (
        block: "active" | "jump",
        side: "left" | "right",
        e: React.MouseEvent
    ) => {
        e.preventDefault();
        resizing.current = { block, side };

        const blockData = block === "active" ? active : jump;
        const blockX = blockData[side === "left" ? "start" : "end"] * blockWidth;
        dragOffset.current = e.clientX - blockX;

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    };


    const onMouseMove = (e: MouseEvent) => {
        if (!resizing.current) return;

        const track = trackRef.current;
        if (track) {
            const rect = track.getBoundingClientRect();
            const inside =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom;

            if (!inside) {
                onMouseUp(); // 바깥으로 나가면 종료
                return;
            }
        }

        const deltaFrames = Math.round(e.movementX / blockWidth);
        if (!resizing.current || deltaFrames === 0) return;

        const mouseX = e.clientX - dragOffset.current;
        const frameX = Math.round(mouseX / blockWidth);

        if (resizing.current.block === "jump") {
            setJump((prev) => {
                let newStart = prev.start;
                let newEnd = prev.end;

                if (resizing.current?.side === "left") {
                    newStart = Math.max(active.start, Math.min(frameX, prev.end));
                } else {
                    newEnd = Math.min(active.end, Math.max(frameX, prev.start));
                }

                return { start: newStart, end: newEnd };
            });
        } else if (resizing.current.block === "active") {
            setActive((prev) => {
                let newStart = prev.start;
                let newEnd = prev.end;

                if (resizing.current?.side === "left") {
                    newStart = Math.min(prev.end, Math.max(frameX, minFrame));
                } else {
                    newEnd = Math.max(prev.start, Math.min(frameX, maxFrame));
                }
                if(jump){
                    setJump((jumpPrev) => {
                        const clampedStart = Math.max(newStart, Math.min(jumpPrev.start, newEnd));
                        const clampedEnd = Math.min(newEnd, Math.max(jumpPrev.end, clampedStart));
                        return { start: clampedStart, end: clampedEnd };
                    });
                }


                return { start: newStart, end: newEnd };
            });
        }
    };


    const onMouseUp = () => {
        resizing.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
    };

    return (
        <div className="timeline-container">

            <div className="ruler">
                {[...Array(range)].map((_, i) => (
                    <div key={i} className="tick">{(i +1) * 50}</div>
                ))}
                <div className="slider-icon"
                     style={{
                         left: `${(sliderValue / 100) * (maxFrame - minFrame) * blockWidth}px`
                     }}
                     onMouseDown={(e) => {
                         setIsDragging(true);
                         e.preventDefault();
                     }}
                >
                    ▲
                </div>
            </div>

            <div className="track" ref={trackRef}>
                {/* Active block */}
                <div
                    className="block active"
                    style={{
                        left: active.start * blockWidth,
                        width: (active.end - active.start) * blockWidth,
                    }}
                    onMouseEnter={() => setActiveHovered(true)}
                    onMouseLeave={() => setActiveHovered(false)}
                >
                    <div className="resize-handle left" onMouseDown={(e) => handleMouseDown("active", "left", e)} />
                    <div className="label">Active</div>
                    <div className="resize-handle right" onMouseDown={(e) => handleMouseDown("active", "right", e)} />

                    {/* + 버튼: jump가 없고 active hovered일 때만 */}
                    {!jump && activeHovered && (
                        <div
                            className="add-button"
                            onClick={() => setJump({ start: active.start, end: active.end })}
                            title="Add jump block"
                        >
                            ＋
                        </div>
                    )}
                </div>

                {/* Jump block */}
                {jump && (
                    <div
                        className="block jump"
                        style={{
                            left: jump.start * blockWidth,
                            width: (jump.end - jump.start) * blockWidth,
                        }}
                        onMouseEnter={() => setJumpHovered(true)}
                        onMouseLeave={() => setJumpHovered(false)}
                    >
                        <div className="resize-handle left" onMouseDown={(e) => handleMouseDown("jump", "left", e)} />
                        <div className="label">Jump</div>
                        <div className="resize-handle right" onMouseDown={(e) => handleMouseDown("jump", "right", e)} />

                        {jumpHovered && (
                            <div
                                className="close-button"
                                onClick={() => setJump(null)}
                                title="Remove jump block"
                            >
                                ×
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
}
