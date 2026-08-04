import React, { useEffect, useRef, useState } from 'react';
import { useLogStore, LogEntry, LogType } from '@stores/useLogStore';

type Filter = 'all' | LogType;

const TYPE_COLOR: Record<LogType, string> = {
    info:  'var(--accent-text)',
    warn:  'var(--color-warning)',
    error: 'var(--color-danger)',
};
const TYPE_BG: Record<LogType, string> = {
    info:  'transparent',
    warn:  'rgba(var(--color-warning-rgb),0.05)',
    error: 'rgba(var(--color-danger-rgb),0.07)',
};
const TYPE_TAG: Record<LogType, string> = {
    info:  'INFO',
    warn:  'WARN',
    error: 'ERR ',
};

const HEADER_H = 30;
const DEFAULT_H = 200;
const MIN_H = 80;

interface ConsolePanelProps {
    embedded?: boolean;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ embedded = false }) => {
    const entries = useLogStore((s) => s.entries);
    const clear   = useLogStore((s) => s.clear);

    const [open, setOpen]     = useState(false);
    const [height, setHeight] = useState(DEFAULT_H);
    const [filter, setFilter] = useState<Filter>('all');

    const bodyRef    = useRef<HTMLDivElement>(null);
    const dragRef    = useRef({ active: false, startY: 0, startH: 0 });
    const draggingNow = useRef(false);

    const errorCount = entries.filter(e => e.type === 'error').length;
    const warnCount  = entries.filter(e => e.type === 'warn').length;
    const visible    = filter === 'all' ? entries : entries.filter(e => e.type === filter);

    // 새 메시지 시 자동 열기 + 스크롤
    useEffect(() => {
        if (entries.length === 0) return;
        const last = entries[entries.length - 1];
        if (last?.type === 'error' || last?.type === 'warn') setOpen(true);
        if (open && bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [entries]);

    useEffect(() => {
        if (open && bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [open]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current.active) return;
            const delta = dragRef.current.startY - e.clientY;
            const next = Math.max(MIN_H, Math.min(window.innerHeight * 0.6, dragRef.current.startH + delta));
            setHeight(next);
        };
        const onUp = () => {
            dragRef.current.active = false;
            draggingNow.current = false;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    const onDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { active: true, startY: e.clientY, startH: height };
        draggingNow.current = true;
        if (!open) { setOpen(true); }
    };

    const fmt = (d: Date) => d.toTimeString().slice(0, 8);

    if (embedded) {
        return (
            <div style={{
                background: 'rgb(var(--surface-1-rgb))',
                borderTop: '1px solid rgba(var(--overlay-rgb),0.09)',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Pretendard, "Apple SD Gothic Neo", sans-serif',
                fontSize: 12,
                marginTop: 8,
            }}>
                {/* 헤더 */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 10px',
                    gap: 6,
                    flexShrink: 0,
                    borderBottom: '1px solid rgba(var(--overlay-rgb),0.07)',
                    cursor: 'pointer',
                }} onClick={() => setOpen(v => !v)}>
                    <span style={{ fontSize: 8, color: 'var(--text-disabled)' }}>{open ? '▼' : '▲'}</span>
                    <span style={{ color: 'rgba(var(--overlay-rgb),0.4)', fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>로그</span>
                    {errorCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-danger)',
                            background: 'rgba(var(--color-danger-rgb),0.1)', padding: '1px 6px', borderRadius: 3 }}>
                            ✕ {errorCount}
                        </span>
                    )}
                    {warnCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-warning)',
                            background: 'rgba(var(--color-warning-rgb),0.1)', padding: '1px 6px', borderRadius: 3 }}>
                            ▲ {warnCount}
                        </span>
                    )}
                    <div style={{ flex: 1 }} />
                    <button
                        onClick={(e) => { e.stopPropagation(); clear(); }}
                        style={{ ...tabBtnStyle, color: 'rgba(var(--overlay-rgb),0.35)', fontSize: 10 }}
                        title="로그 지우기"
                    >
                        지우기
                    </button>
                </div>
                {open && (
                    <div ref={bodyRef} style={{ maxHeight: 180, overflowY: 'auto', overflowX: 'hidden' }}>
                        {entries.length === 0 ? (
                            <div style={{ padding: '10px 12px', color: 'rgba(var(--overlay-rgb),0.3)', fontSize: 11 }}>표시할 로그가 없습니다.</div>
                        ) : (
                            [...entries].reverse().map(e => <LogRow key={e.id} entry={e} fmt={fmt} />)
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: 0, left: 0, right: 0,
            height: open ? height : HEADER_H,
            background: 'rgb(var(--surface-1-rgb))',
            borderTop: '1px solid rgba(var(--overlay-rgb),0.09)',
            zIndex: 900,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Pretendard, "Apple SD Gothic Neo", sans-serif',
            fontSize: 12,
        }}>
            {/* 드래그 핸들 */}
            <div
                onMouseDown={onDragStart}
                style={{
                    height: 4,
                    cursor: 'ns-resize',
                    flexShrink: 0,
                    background: 'transparent',
                }}
            />

            {/* 헤더 */}
            <div style={{
                height: HEADER_H - 4,
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
                gap: 6,
                flexShrink: 0,
                borderBottom: open ? '1px solid rgba(var(--overlay-rgb),0.07)' : 'none',
            }}>
                <button onClick={() => setOpen(v => !v)} style={toggleBtnStyle}>
                    <span style={{ fontSize: 8, color: 'var(--text-disabled)' }}>{open ? '▼' : '▲'}</span>
                    <span style={{ color: 'rgba(var(--overlay-rgb),0.45)', marginLeft: 6, fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>로그</span>
                </button>

                <div style={dividerStyle} />

                {/* 에러/경고 뱃지 */}
                {errorCount > 0 && (
                    <button
                        onClick={() => setFilter(f => f === 'error' ? 'all' : 'error')}
                        style={{ ...badgeStyle, color: 'var(--color-danger)', background: filter === 'error' ? 'rgba(var(--color-danger-rgb),0.2)' : 'rgba(var(--color-danger-rgb),0.08)' }}
                    >
                        ✕ {errorCount}
                    </button>
                )}
                {warnCount > 0 && (
                    <button
                        onClick={() => setFilter(f => f === 'warn' ? 'all' : 'warn')}
                        style={{ ...badgeStyle, color: 'var(--color-warning)', background: filter === 'warn' ? 'rgba(var(--color-warning-rgb),0.2)' : 'rgba(var(--color-warning-rgb),0.08)' }}
                    >
                        ▲ {warnCount}
                    </button>
                )}

                <div style={{ flex: 1 }} />

                {/* 필터 탭 */}
                {(['all', 'info', 'warn', 'error'] as Filter[]).map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{
                        ...tabBtnStyle,
                        color: filter === f ? 'var(--text-secondary)' : 'rgba(var(--overlay-rgb),0.35)',
                        borderBottom: filter === f ? '1px solid var(--accent)' : '1px solid transparent',
                    }}>
                        {f === 'all' ? '전체' : f === 'info' ? '정보' : f === 'warn' ? '경고' : '오류'}
                    </button>
                ))}

                <div style={dividerStyle} />

                <button onClick={clear} style={{ ...tabBtnStyle, color: 'rgba(var(--overlay-rgb),0.35)' }} title="로그 지우기">
                    지우기
                </button>
            </div>

            {/* 로그 목록 */}
            {open && (
                <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                    {visible.length === 0 ? (
                        <div style={{ padding: '12px 16px', color: 'rgba(var(--overlay-rgb),0.3)', fontSize: 11 }}>표시할 로그가 없습니다.</div>
                    ) : (
                        visible.map(e => <LogRow key={e.id} entry={e} fmt={fmt} />)
                    )}
                </div>
            )}
        </div>
    );
};

const LogRow = React.memo(({ entry, fmt }: { entry: LogEntry; fmt: (d: Date) => string }) => (
    <div style={{
        display: 'flex',
        alignItems: 'baseline',
        padding: '4px 12px',
        gap: 10,
        background: TYPE_BG[entry.type],
        borderBottom: '1px solid rgba(var(--overlay-rgb),0.02)',
    }}>
        <span style={{ color: 'rgba(var(--overlay-rgb),0.3)', fontSize: 10, flexShrink: 0, fontFamily: 'monospace', paddingTop: 1 }}>
            {fmt(entry.timestamp)}
        </span>
        <span style={{
            color: TYPE_COLOR[entry.type],
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            flexShrink: 0,
            fontFamily: 'monospace',
        }}>
            {TYPE_TAG[entry.type]}
        </span>
        <span style={{ color: entry.type === 'error' ? 'rgba(var(--color-danger-rgb),0.85)' : entry.type === 'warn' ? 'rgba(var(--color-warning-rgb),0.8)' : 'rgba(var(--accent-text-rgb),0.75)', lineHeight: 1.5 }}>
            {entry.text}
        </span>
    </div>
));

const toggleBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none',
    cursor: 'pointer', display: 'flex',
    alignItems: 'center', padding: '2px 4px',
    borderRadius: 3,
};
const dividerStyle: React.CSSProperties = {
    width: 1, height: 14,
    background: 'rgba(var(--overlay-rgb),0.08)',
    flexShrink: 0,
};
const badgeStyle: React.CSSProperties = {
    border: 'none', fontSize: 10,
    fontWeight: 700, cursor: 'pointer',
    padding: '1px 7px', borderRadius: 3,
};
const tabBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none',
    fontSize: 11, cursor: 'pointer',
    padding: '2px 8px', color: 'rgba(var(--overlay-rgb),0.35)',
};
