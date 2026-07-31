import React, { useEffect, useRef } from 'react';
import { useWorkflowStore } from "@stores/useWorkflowStore";
import { useMenuStore } from "@stores/useMenuStore";
import styles from "@css/Taskbar.module.css";

/** taskbar 의 화면 좌표 — App 이 컨테이너 하단과 비교해 실제 inset 을 계산한다 */
export interface TaskbarRect {
    top: number;
    height: number;
}

export interface TaskbarProps {
    /** 실제 렌더된 taskbar 의 rect 를 알린다. 렌더되지 않는 동안에는 null. */
    onRectChange?: (rect: TaskbarRect | null) => void;
}

const Taskbar = ({ onRectChange }: TaskbarProps) => {
    const sessions = useWorkflowStore((s: any) => s.sessions);
    const activeMenuCode = useWorkflowStore((s: any) => s.activeMenuCode);
    const toggleSession = useWorkflowStore((s: any) => s.toggleSession);
    const closeSession = useWorkflowStore((s: any) => s.closeSession);
    const setActiveSubmenu = useMenuStore((s) => s.setActiveSubmenu);

    // taskbar 크기/위치의 단일 관리점 — CSS(.edit-taskbar)를 바꿔도 자동으로 따라가도록
    // 실제 DOM rect 를 측정해 발행한다. TS 상수로 같은 숫자를 복제하지 않는다.
    const rootRef = useRef<HTMLDivElement>(null);
    const hasSessions = sessions.length > 0;
    useEffect(() => {
        const el = rootRef.current;
        if (!el) { onRectChange?.(null); return; }
        const report = () => {
            const r = el.getBoundingClientRect();
            onRectChange?.({ top: r.top, height: r.height });
        };
        // ResizeObserver/resize 콜백은 레이아웃이 아직 확정되지 않은 시점에 불릴 수 있어
        // 그 자리에서 rect 를 읽으면 이전 프레임 좌표가 올라간다(칩 추가/삭제로 taskbar
        // 높이가 바뀌는 경우). 다음 프레임으로 미뤄 확정된 좌표만 보고한다.
        let deferRaf: number | null = null;
        const scheduleReport = () => {
            if (deferRaf !== null) return;
            deferRaf = requestAnimationFrame(() => {
                deferRaf = null;
                report();
            });
        };
        report();
        // 폰트/스타일 적용 후 좌표가 확정되는 프레임에서 한 번 더 (초기 0 방지)
        const raf = requestAnimationFrame(report);
        const onWinResize = () => scheduleReport();
        window.addEventListener("resize", onWinResize);
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleReport) : null;
        ro?.observe(el);
        // 언마운트(세션 0개 등) 시 null 로 되돌려 하단 패널이 화면 끝까지 쓰게 한다
        return () => {
            cancelAnimationFrame(raf);
            if (deferRaf !== null) cancelAnimationFrame(deferRaf);
            window.removeEventListener("resize", onWinResize);
            ro?.disconnect();
            onRectChange?.(null);
        };
    }, [hasSessions, onRectChange]);

    if (!hasSessions) return null;

    const handleChipClick = (session: any) => {
        const isActive = activeMenuCode === session.menuCode && !session.isMinimized;
        toggleSession(session.menu);
        // activeSubmenu를 워크플로와 동기화
        setActiveSubmenu(isActive ? null : session.menu);
    };

    return (
        <div ref={rootRef} className={styles['edit-taskbar']}>
            {sessions.map((session: any) => (
                <div
                    key={session.menuCode}
                    className={`${styles['task-chip']} ${activeMenuCode === session.menuCode ? styles.active : ''}`}
                    onClick={() => handleChipClick(session)}
                >
                    <span className={styles['chip-dot']}/>
                    <span className={styles['chip-label']}>{session.nameKor}</span>
                    <span
                        className={styles['chip-close']}
                        onClick={(e) => {
                            e.stopPropagation();
                            closeSession(session.menuCode);
                            // 닫은 후 활성 세션의 activeSubmenu 동기화
                            const state = useWorkflowStore.getState() as any;
                            const next = (state.sessions as any[]).find((s: any) => s.menuCode === state.activeMenuCode);
                            setActiveSubmenu(next?.menu ?? null);
                        }}
                    >✕</span>
                </div>
            ))}
        </div>
    );
};
export default Taskbar;