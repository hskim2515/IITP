import React from 'react';
import { useWorkflowStore } from "@stores/useWorkflowStore";
import styles from "@css/Taskbar.module.css";

const Taskbar = () => {
    const sessions = useWorkflowStore((s: any) => s.sessions);
    const activeMenuCode = useWorkflowStore((s: any) => s.activeMenuCode);
    const toggleSession = useWorkflowStore((s: any) => s.toggleSession);
    const closeSession = useWorkflowStore((s: any) => s.closeSession);

    if (sessions.length === 0) return null;

    return (
        <div className={styles['edit-taskbar']}>
            {sessions.map((session: any) => (
                <div
                    key={session.menuCode}
                    className={`${styles['task-chip']} ${activeMenuCode === session.menuCode ? styles.active : ''}`}
                    onClick={() => toggleSession(session.menu)}
                >
                    <span className={styles['chip-dot']}/>
                    <span className={styles['chip-label']}>{session.nameKor}</span>
                    <span
                        className={styles['chip-close']}
                        onClick={(e) => {
                            e.stopPropagation();
                            closeSession(session.menuCode);
                        }}
                    >✕</span>
                </div>
            ))}
        </div>
    );
};
export default Taskbar;