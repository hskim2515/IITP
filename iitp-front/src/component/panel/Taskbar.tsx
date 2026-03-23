import React from 'react';
import { useWorkflowStore } from "@stores/useWorkflowStore";

const Taskbar = () => {
    const { sessions, activeMenuCode, openSession, minimizeSession, closeSession } = useWorkflowStore();

    if (sessions.length === 0) return null;

    return (
        <div className="edit-taskbar">
            {sessions.map((session) => (
                <div
                    key={session.menuCode}
                    className={`task-chip ${activeMenuCode === session.menuCode ? 'active' : ''}`}
                    onClick={() => openSession(session)}
                >
                    <span className="chip-dot"/>
                    <span className="chip-label">{session.nameKor}</span>
                    <span className="chip-close" onClick={(e) => {
                        e.stopPropagation();
                        closeSession(session.menuCode);
                    }}>✕</span>
                </div>
            ))}
        </div>
    );
};
export default Taskbar;