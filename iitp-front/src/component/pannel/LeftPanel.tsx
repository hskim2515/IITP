import React from "react";
import { usePanelStore } from "@stores/usePanelStore";

const LeftPanel: React.FC = () => {
    const { activePanel, setActivePanel } = usePanelStore();

    if (!activePanel) return null;

    return (
        <div style={styles.sidebar}>
            <div style={styles.header}>
                <h3>{activePanel}</h3>
                <button style={styles.closeButton} onClick={() => setActivePanel(null)}>×</button>
            </div>
            <p>{activePanel} 패널 내용</p>
        </div>
    );
};

// 스타일 정의
const styles = {
    sidebar: {
        width: "200px",
        backgroundColor: "#222",
        color: "#fff",
        padding: "20px",
        position: "fixed" as const,
        left: 0,
        top: "50px",
        zIndex:999,
        bottom: 0,
        display: "flex",
        flexDirection: "column" as const,
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px",
    },
    closeButton: {
        background: "none",
        border: "none",
        color: "#fff",
        fontSize: "20px",
        cursor: "pointer",
    },
};

export default LeftPanel;
