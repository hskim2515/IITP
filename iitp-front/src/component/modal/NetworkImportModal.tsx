import React, { useRef, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useWorkflowStore } from '@stores/useWorkflowStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { assignPropertyToResponseData } from '@utils/guid';
import { useOnboardingStore } from '@stores/useOnboardingStore';
import { useLogStore } from '@stores/useLogStore';
import { confirmAndDownloadBackup } from '@utils/autoSave';
import { flyToNetworkExtent } from '@hooks/useLayerInit';
import { NETWORK_TILING } from '@utils/lodConstants';
import { useCesiumStore } from '@stores/useCesiumStore';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';

const MENU_CODE = 'NETWORK_IMPORT';

const NetworkImportModal: React.FC = () => {
    const closeSession = useWorkflowStore((s: any) => s.closeSession) as (code: string) => void;
    const versionId = getActiveVersionId() ?? '';

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingData, setPendingData] = useState<any>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    const handleClose = () => {
        setPendingData(null);
        setWarnings([]);
        closeSession(MENU_CODE);
    };

    const handleFile = (file: File) => {
        if (!file.name.endsWith('.xml')) {
            setError('XML 파일만 지원합니다.');
            return;
        }
        setSelectedFile(file);
        setError(null);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    };

    const handleImport = async () => {
        if (!selectedFile) {
            setError('파일을 선택하세요.');
            return;
        }
        setError(null);

        // 백업 여부 확인 후 다운로드
        if (versionId) await confirmAndDownloadBackup(versionId);

        setLoading(true);
        try {
            // 업로드 및 저장
            const formData = new FormData();
            formData.append('file', selectedFile);

            const res = await fetch(
                `${import.meta.env.VITE_API_URL}/network/${versionId}/import`,
                { method: 'POST', body: formData }
            );
            const data = await res.json();
            if (!res.ok) {
                if (data?.errors?.includes('MISSING_COORDINATES')) {
                    throw new Error('이 시나리오에 기준 좌표(위/경도)가 설정되지 않았습니다.\n시나리오 설정에서 기준 좌표를 먼저 입력하세요.');
                }
                const msgs: string[] = [...(data?.errors ?? []), ...(data?.warnings ?? [])];
                throw new Error(msgs.length ? msgs.join('\n') : `서버 오류 ${res.status}`);
            }
            setPendingData(data.network);
            setWarnings(data.warnings ?? []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : '알 수 없는 오류');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmReplace = () => {
        if (!pendingData) return;
        assignPropertyToResponseData(pendingData);
        if (NETWORK_TILING.ENABLED) {
            // 타일 모드: 전체를 store 에 적재하지 않음 (메모리를 viewport 로 제한).
            // 메타(id/name)만 둔 빈 네트워크로 시작 → 타일 매니저가 viewport 네트워크를 동기화.
            useNetworkStore.getState().setCurrentJsonDataWithFullBuild({
                ...pendingData, links: [], nodes: [],
            } as any);
        } else {
            useNetworkStore.getState().setCurrentJsonDataWithFullBuild(pendingData);
        }
        useNetworkStore.getState().setChange(true);
        const nodeCount = pendingData.nodes?.length ?? 0;
        const linkCount = pendingData.links?.length ?? 0;
        useLogStore.getState().addLog('info', `네트워크 반영 완료 (노드 ${nodeCount}개, 링크 ${linkCount}개)`);
        useOnboardingStore.getState().setStep('need-dummy');
        handleClose();
        // 임포트 후 네트워크 위치로 카메라 이동
        const viewer = useCesiumStore.getState().viewer;
        const olMap = useOpenLayersStore.state.map();
        flyToNetworkExtent(viewer, olMap);
    };

    // ── 저장 완료 확인 다이얼로그 ─────────────────────────────────────────────
    if (pendingData) {
        const nodeCount = pendingData.nodes?.length ?? 0;
        const linkCount = pendingData.links?.length ?? 0;
        return (
            <div style={overlayStyle}>
                <div style={{ ...panelStyle, width: 380 }}>
                    <div style={headerStyle}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>네트워크 저장 완료</span>
                    </div>
                    <div style={bodyStyle}>
                        <p style={{ fontSize: 12, color: '#ccc', margin: 0 }}>
                            서버에 network.xml이 저장되었습니다.
                        </p>
                        <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
                            노드 {nodeCount}개 · 링크 {linkCount}개
                        </p>
                        {warnings.length > 0 && (
                            <div style={warningBoxStyle}>
                                <p style={{ fontSize: 10, color: '#f0c040', margin: '0 0 4px 0', fontWeight: 600 }}>
                                    ⚠ 경고 {warnings.length}건 — 시뮬레이션 전 보정을 권장합니다.
                                </p>
                                {warnings.map((w, i) => (
                                    <p key={i} style={{ fontSize: 10, color: '#c8a840', margin: '2px 0' }}>• {w}</p>
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={footerStyle}>
                        <button style={cancelBtnStyle} onClick={() => { setPendingData(null); setWarnings([]); }}>
                            닫기
                        </button>
                        <button style={importBtnStyle} onClick={handleConfirmReplace}>
                            지도에 반영
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── 메인 모달 ─────────────────────────────────────────────────────────────
    return (
        <div style={overlayStyle}>
            <div style={panelStyle}>
                <div style={headerStyle}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>네트워크 XML 임포트</span>
                    <button style={closeBtnStyle} onClick={handleClose}>×</button>
                </div>

                <div style={bodyStyle}>
                    <p style={descStyle}>
                        network.xml 파일을 업로드하여 서버에 저장하고 지도에 반영합니다.
                    </p>

                    {/* 드래그 앤 드롭 영역 */}
                    <div
                        style={{
                            ...dropZoneStyle,
                            borderColor: isDragging ? 'rgba(65,105,225,0.7)' : 'rgba(255,255,255,0.12)',
                            background: isDragging ? 'rgba(65,105,225,0.08)' : 'rgba(255,255,255,0.03)',
                        }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div style={{ fontSize: 24, opacity: 0.5, marginBottom: 6 }}>📂</div>
                        {selectedFile ? (
                            <>
                                <div style={{ fontSize: 12, color: '#7aa2ff' }}>{selectedFile.name}</div>
                                <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 11, color: '#888' }}>XML 파일을 끌어오거나</div>
                                <div style={{ fontSize: 11, color: '#7aa2ff', cursor: 'pointer' }}>클릭하여 선택</div>
                            </>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xml"
                            style={{ display: 'none' }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                        />
                    </div>

                    {error && <div style={errorStyle}>{error}</div>}

                </div>

                <div style={footerStyle}>
                    <button style={cancelBtnStyle} onClick={handleClose} disabled={loading}>
                        취소
                    </button>
                    <button
                        style={loading || !selectedFile ? { ...importBtnStyle, opacity: 0.5 } : importBtnStyle}
                        onClick={handleImport}
                        disabled={loading || !selectedFile}
                    >
                        {loading ? '저장 중...' : '업로드 및 저장'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── 스타일 ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1200,
};
const panelStyle: React.CSSProperties = {
    background: 'rgba(14,16,28,0.98)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
    width: 400, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    color: '#e0e0e0',
};
const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#888',
    fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px',
};
const bodyStyle: React.CSSProperties = {
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
};
const descStyle: React.CSSProperties = {
    fontSize: 11, color: '#777', margin: 0, lineHeight: 1.6,
};
const dropZoneStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '24px 12px', borderRadius: 8, border: '1px dashed',
    cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s', gap: 4,
};
const warningBoxStyle: React.CSSProperties = {
    marginTop: 4, padding: '8px 10px', borderRadius: 6,
    background: 'rgba(255,200,50,0.06)', border: '1px solid rgba(255,200,50,0.25)',
};
const errorStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 6, fontSize: 11,
    background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,60,60,0.3)',
    color: '#f07070', whiteSpace: 'pre-line',
};
const noteStyle: React.CSSProperties = {
    fontSize: 10, color: '#555', lineHeight: 1.5,
};
const footerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.07)',
};
const cancelBtnStyle: React.CSSProperties = {
    padding: '6px 14px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#aaa', cursor: 'pointer',
};
const importBtnStyle: React.CSSProperties = {
    padding: '6px 16px', fontSize: 12, borderRadius: 5,
    border: '1px solid rgba(65,105,225,0.5)', background: 'rgba(65,105,225,0.2)',
    color: '#7aa2ff', cursor: 'pointer', fontWeight: 600,
};

export default NetworkImportModal;
