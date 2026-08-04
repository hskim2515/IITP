import React from 'react';
import { ProgressState } from '@hooks/useImportProgress';

interface Props {
    progress: ProgressState;
    color?: string;
}

const ImportProgressBar: React.FC<Props> = ({ progress, color = 'var(--accent-text)' }) => {
    if (!progress.running && progress.percent === 0) return null;

    const done = !progress.running && progress.percent === 100;

    return (
        <div style={{ marginTop: 8 }}>
            {/* 레이블 행 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: done ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                    {done ? '✓ 완료' : (
                        <>
                            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 4 }}>⟳</span>
                            {progress.stepLabel}
                        </>
                    )}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                    {done ? '' : `${progress.elapsed}s`}
                    &nbsp;{progress.percent}%
                </span>
            </div>

            {/* 진행 바 */}
            <div style={{
                width: '100%', height: 4, borderRadius: 2,
                background: 'rgba(var(--overlay-rgb), 0.08)',
                overflow: 'hidden',
            }}>
                <div style={{
                    height: '100%',
                    width: `${progress.percent}%`,
                    background: done ? 'var(--color-success)' : color,
                    borderRadius: 2,
                    transition: 'width 0.2s ease, background 0.3s',
                }}/>
            </div>

            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default ImportProgressBar;
