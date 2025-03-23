import React, { useState } from 'react';
import { usePanelStore } from "@stores/usePanelStore";
import SimulationControls from "./SimulationControls";

const Header: React.FC = () => {
    return (
        <header style={styles.header}>
            {/*<h1 style={styles.title}>IITP</h1>*/}

            <nav style={styles.nav}>
                <DropdownMenu title="파일" items={["네트워크", "시나리오"]} />
                <DropdownMenu title="편집" items={["시설물", "수요", "시나리오", "교통수단", "대중교통 노선"]} />
                <DropdownMenu title="시뮬레이션" items={["시뮬레이션 설정"]} />
            </nav>
            <SimulationControls />
        </header>
    );
};

// 드롭다운 메뉴 컴포넌트
const DropdownMenu: React.FC<{ title: string; items: string[] }> = ({ title, items }) => {
    const [isOpen, setIsOpen] = useState(false);
    const { setActivePanel } = usePanelStore();

    return (
        <div
            style={styles.menuContainer}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            <span style={styles.menuTitle}>{title}</span>
            {isOpen && (
                <div style={styles.dropdown}>
                    {items.map((item, index) => (
                        <div
                            key={index}
                            style={styles.menuItem}
                            onClick={() => setActivePanel(item)} // 클릭하면 패널 열기
                        >
                            {item}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// 스타일 정의
const styles = {
    header: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        width: '98%',
        height: '50px',
        backgroundColor: '#333',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 1000,
    },
    title: {
        fontSize: '18px',
    },
    nav: {
        display: 'flex',
        gap: '20px',
    },
    menuContainer: {
        position: 'relative' as const,
        cursor: 'pointer',
    },
    menuTitle: {
        padding: '10px',
        fontSize: '16px',
    },
    dropdown: {
        position: 'absolute' as const,
        top: '100%',
        left: 0,
        backgroundColor: '#444',
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
        borderRadius: '4px',
        overflow: 'hidden',
        minWidth: '150px',
    },
    menuItem: {
        padding: '10px',
        cursor: 'pointer',
        color: '#fff',
        fontSize: '14px',
        borderBottom: '1px solid #555',
        backgroundColor: '#444',
        transition: 'background 0.3s',
    },
};

export default Header;
