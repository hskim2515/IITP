import React, { useEffect, useState } from 'react';
import { useMenuStore } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";
import { apiConfig } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import DropdownMenu from "@component/header/DropdownMenu";
import DataIOPanel from '@component/tool/DataIOPanel';
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/Header.module.css"

type Section = 'export' | 'import';

const SECTION_MAP: Record<string, Section> = {
    '내보내기': 'export',
    '가져오기': 'import',
    'FILE_EXPORT': 'export',
    'FILE_IMPORT': 'import',
};

/* ── DataIO 모달 ── */
const DataIOModal: React.FC<{ section: Section; onClose: () => void }> = ({ section, onClose }) => {
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
    }, [onClose]);

    const title = section === 'export' ? '내보내기' : '가져오기';

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0,
                    background: 'rgba(0,0,0,0.35)',
                    zIndex: 1200,
                }}
            />
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    position: 'fixed',
                    top: '54px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 340,
                    maxHeight: 'calc(100vh - 70px)',
                    background: 'rgba(13,15,24,0.98)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10,
                    boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
                    zIndex: 1201,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>
                        파일 › {title}
                    </span>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none', border: 'none',
                            color: '#666', cursor: 'pointer',
                            fontSize: 16, lineHeight: 1, padding: '2px 4px',
                        }}
                    >×</button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
                    <DataIOPanel hideHeader section={section} />
                </div>
            </div>
        </>
    );
};

const HeaderMenu = () => {
    const { menu, setMenu } = useMenuStore(useShallow((state) => ({
        menu: state.menu,
        setMenu: state.setMenu,
    })));

    const [activeSection, setActiveSection] = useState<Section | null>(null);

    useEffect(() => {
        const fetchMenu = async () => {
            try {
                const config = apiConfig["MENU"]?.tree;
                const response = await axiosInstance({ method: config?.method, url: config?.url });
                setMenu(response.data);
            } catch (e) {
                console.error(e);
            }
        };
        fetchMenu();
    }, [setMenu]);

    const topMenus = menu ? menu.filter(item => item.depth === 0) : [];

    const handleFileItemClick = (item: MenuTreeResponse) => {
        const section =
            (item.menuCode && SECTION_MAP[item.menuCode]) ||
            (item.nameKor && SECTION_MAP[item.nameKor]) ||
            null;
        if (section) setActiveSection(section);
    };

    return (
        <>
            <nav className={styles['nav']}>
                {topMenus.map(menuItem => {
                    const isFileMenu =
                        menuItem.menuCode === 'FILE' || menuItem.nameKor === '파일';

                    return (
                        <DropdownMenu
                            key={menuItem.menuId}
                            title={menuItem.nameKor ?? ''}
                            items={menuItem.children ?? []}
                            onItemClick={isFileMenu ? handleFileItemClick : undefined}
                        />
                    );
                })}
            </nav>

            {activeSection && (
                <DataIOModal
                    section={activeSection}
                    onClose={() => setActiveSection(null)}
                />
            )}
        </>
    );
};

export default HeaderMenu;
