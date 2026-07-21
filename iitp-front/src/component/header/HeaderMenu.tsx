import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMenuStore, findMenuByCode } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";
import { apiConfig } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import DataIOPanel from '@component/tool/DataIOPanel';
import FileImportModal from '@component/modal/FileImportModal';
import { useWorkflowStore } from "@stores/useWorkflowStore";
import styles from "@css/Header.module.css"

type FileAction = 'import' | 'export' | 'schema';

const FILE_ITEMS: { label: string; action: FileAction }[] = [
    { label: '가져오기', action: 'import' },
    { label: '내보내기', action: 'export' },
    { label: '스키마 설정', action: 'schema' },
];

/* ── 내보내기 모달 ── */
const ExportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
    }, [onClose]);

    return createPortal(
        <>
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2100 }} />
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    position: 'fixed', top: '54px', left: '50%', transform: 'translateX(-50%)',
                    width: 340, maxHeight: 'calc(100vh - 70px)',
                    background: 'rgba(13,15,24,0.98)', backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                    boxShadow: '0 16px 48px rgba(0,0,0,0.7)', zIndex: 2101,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>내보내기</span>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
                    <DataIOPanel hideHeader section="export" />
                </div>
            </div>
        </>,
        document.body
    );
};

/* ── 파일 드롭다운 ── */
const FileDropdown: React.FC<{ onSelect: (action: FileAction) => void }> = ({ onSelect }) => {
    const [open, setOpen] = useState(false);

    return (
        <div
            className={styles.container}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <span className={styles.title}>파일</span>
            {open && (
                <div className={styles.dropdown}>
                    {FILE_ITEMS.map(({ label, action }) => (
                        <div key={action} className={styles.item} onClick={() => { setOpen(false); onSelect(action); }}>
                            {label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/* ── 나머지 상단 메뉴 (파일 제외) ── */
const TopMenu: React.FC<{ title: string; children: any[] }> = ({ title, children }) => {
    const { setActiveDropdownMenu, setActiveSubmenu } = useMenuStore(
        useShallow(s => ({ setActiveDropdownMenu: s.setActiveDropdownMenu, setActiveSubmenu: s.setActiveSubmenu }))
    );
    const openSession = (item: any) => (useWorkflowStore.getState() as any).openSession(item);
    const [open, setOpen] = useState(false);

    const availableChildren = children.filter((item: any) => item.available !== 'N');

    const handleItemClick = (item: any) => {
        setOpen(false);
        const visibleChildren = (item.children ?? []).filter((c: any) => c.available !== 'N');
        const hasChildren = visibleChildren.length > 0;
        if (hasChildren) {
            setActiveDropdownMenu(item);
        } else {
            // leaf 항목: 세션 직접 열기
            setActiveSubmenu(item);
            openSession(item);
        }
    };

    return (
        <div
            className={styles.container}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <span className={styles.title}>{title}</span>
            {open && (
                <div className={styles.dropdown}>
                    {availableChildren.map((item: any) => (
                        <div key={item.menuId} className={styles.item} onClick={() => handleItemClick(item)}>
                            {item.nameKor}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/* ── HeaderMenu ── */
const HeaderMenu = () => {
    const { menu, setMenu, setActiveDropdownMenu } = useMenuStore(useShallow((state) => ({
        menu: state.menu,
        setMenu: state.setMenu,
        setActiveDropdownMenu: state.setActiveDropdownMenu,
    })));

    const [activeAction, setActiveAction] = useState<FileAction | null>(null);

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

    const handleFileAction = (action: FileAction) => {
        if (action === 'schema') {
            const schemaMenu = menu ? findMenuByCode(menu, 'SCHEMA_SETTING') : null;
            if (schemaMenu) setActiveDropdownMenu(schemaMenu);
            return;
        }
        setActiveAction(action);
    };

    const topMenus = (menu ?? []).filter(item => item.depth === 0 && item.menuCode !== 'FILE');

    return (
        <>
            <FileDropdown onSelect={handleFileAction} />
            {topMenus.map(menuItem => (
                <TopMenu
                    key={menuItem.menuId}
                    title={menuItem.nameKor ?? ''}
                    children={menuItem.children ?? []}
                />
            ))}

            {activeAction === 'import' && (
                <FileImportModal onClose={() => setActiveAction(null)} />
            )}
            {activeAction === 'export' && (
                <ExportModal onClose={() => setActiveAction(null)} />
            )}
        </>
    );
};

export default HeaderMenu;
