import React from 'react';
import { useWorkflowStore } from "@stores/useWorkflowStore";
import { useMenuStore } from "@stores/useMenuStore";
import styles from "@css/Taskbar.module.css";

/** taskbar 는 App.tsx 의 flex column 안에서 지도 컨테이너의 형제로 놓인다 —
 *  패널 위를 덮지 않으므로 높이를 측정해 App 으로 올릴 필요가 없다(높이는 CSS 단독 관리). */
const Taskbar = () => {
    const sessions = useWorkflowStore((s: any) => s.sessions);
    const activeMenuCode = useWorkflowStore((s: any) => s.activeMenuCode);
    const toggleSession = useWorkflowStore((s: any) => s.toggleSession);
    const closeSession = useWorkflowStore((s: any) => s.closeSession);
    const setActiveSubmenu = useMenuStore((s) => s.setActiveSubmenu);

    if (sessions.length === 0) return null;

    const handleChipClick = (session: any) => {
        const isActive = activeMenuCode === session.menuCode && !session.isMinimized;
        toggleSession(session.menu);
        // activeSubmenu를 워크플로와 동기화
        setActiveSubmenu(isActive ? null : session.menu);
    };

    return (
        <div className={styles['edit-taskbar']}>
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