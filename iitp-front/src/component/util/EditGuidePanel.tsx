import React from 'react';
import { useEditGuideStore } from '@stores/useEditGuideStore';

/**
 * 편집 모드 상시 안내 패널 — 지도 하단 중앙.
 * 토스트(2초 소멸)와 달리 모드가 켜져 있는 동안 계속 떠서 조작법을 안내한다.
 * pointerEvents: none — 지도 조작을 절대 가로막지 않음.
 */
export default function EditGuidePanel() {
    const guide = useEditGuideStore((s) => s.guide);
    if (!guide) return null;

    return (
        <div style={wrapStyle}>
            <div style={cardStyle}>
                <div style={titleStyle}>
                    <span style={dotStyle} />
                    {guide.title}
                </div>
                {guide.steps.map((s, i) => (
                    <div key={i} style={{ ...stepStyle, ...(s.em ? stepEmStyle : null) }}>
                        {s.keys && s.keys.length > 0 && (
                            <span style={{ flexShrink: 0 }}>
                                {s.keys.map((k, j) => (
                                    <kbd key={j} style={kbdStyle}>{k}</kbd>
                                ))}
                            </span>
                        )}
                        <span>{s.text}</span>
                    </div>
                ))}
                {guide.tip && <div style={tipStyle}>💡 {guide.tip}</div>}
            </div>
        </div>
    );
}

const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 52,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9500,
    pointerEvents: 'none',
    maxWidth: 620,
    width: 'max-content',
};

const cardStyle: React.CSSProperties = {
    background: 'rgba(10, 14, 26, 0.88)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(0, 220, 255, 0.25)',
    borderRadius: 10,
    padding: '10px 16px 9px',
    boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
    fontSize: 12,
    lineHeight: 1.5,
    color: 'rgba(225, 232, 245, 0.92)',
};

const titleStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontWeight: 700,
    fontSize: 12.5,
    color: '#7fe8ff',
    marginBottom: 6,
    letterSpacing: 0.3,
};

const dotStyle: React.CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#00dcff',
    boxShadow: '0 0 6px rgba(0,220,255,0.8)',
};

const stepStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    padding: '1.5px 0 1.5px 4px',
    color: 'rgba(200, 210, 228, 0.82)',
};

const stepEmStyle: React.CSSProperties = {
    color: '#fff',
    background: 'rgba(0, 220, 255, 0.08)',
    borderLeft: '2px solid rgba(0,220,255,0.7)',
    borderRadius: 3,
    paddingLeft: 8,
};

const kbdStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '0px 7px',
    marginRight: 4,
    borderRadius: 5,
    background: 'rgba(255,255,255,0.10)',
    border: '1px solid rgba(255,255,255,0.22)',
    borderBottomWidth: 2,
    fontSize: 10.5,
    fontFamily: 'inherit',
    fontWeight: 600,
    color: 'rgba(240,245,255,0.95)',
    whiteSpace: 'nowrap',
};

const tipStyle: React.CSSProperties = {
    marginTop: 5,
    paddingTop: 5,
    borderTop: '1px solid rgba(255,255,255,0.08)',
    fontSize: 11,
    color: 'rgba(170, 182, 205, 0.75)',
};
