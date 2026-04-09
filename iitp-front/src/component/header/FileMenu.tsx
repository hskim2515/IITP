import React, { useState, useEffect, useRef } from 'react';
import styles from '@css/Header.module.css';
import DataIOPanel from '@component/tool/DataIOPanel';

type Section = 'export' | 'import';

const ITEMS: { label: string; section: Section }[] = [
    { label: '내보내기', section: 'export' },
    { label: '가져오기', section: 'import' },
];

const FileMenu: React.FC = () => {
    const [dropOpen, setDropOpen]       = useState(false);
    const [activeSection, setSection]   = useState<Section | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setDropOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);

    const open = (section: Section) => {
        setDropOpen(false);
        setSection(section);
    };

    return (
        <>
            <div
                ref={containerRef}
                className={styles.container}
                onMouseEnter={() => setDropOpen(true)}
                onMouseLeave={() => setDropOpen(false)}
            >
                <span className={styles.title}>파일</span>

                {dropOpen && (
                    <div className={styles.dropdown}>
                        {ITEMS.map(({ label, section }) => (
                            <div key={section} className={styles.item} onClick={() => open(section)}>
                                {label}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {activeSection && (
                <DataIOModal
                    section={activeSection}
                    onClose={() => setSection(null)}
                />
            )}
        </>
    );
};

/* ── 섹션별 모달 ── */
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
                {/* 헤더 */}
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
                        title="닫기"
                    >
                        ×
                    </button>
                </div>

                {/* 본문 */}
                <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
                    <DataIOPanel hideHeader section={section} />
                </div>
            </div>
        </>
    );
};

export default FileMenu;
