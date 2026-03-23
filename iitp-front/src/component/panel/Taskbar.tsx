import React from 'react';
import { useWorkflowStore } from "@stores/useWorkflowStore";
import styles from "@css/Taskbar.module.css";

const Taskbar = () => {
    const { sessions, activeMenuCode, openSession, minimizeSession, closeSession } = useWorkflowStore();

    if (sessions.length === 0) return null;

    return (
        <div className={styles['edit-taskbar']}>
            {sessions.map((session) => (
                <div
                    key={session.menuCode}
                    className={`${styles['task-chip']} ${activeMenuCode === session.menuCode ? styles.active : ''}`}
                    onClick={() => openSession(session.menu)}
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