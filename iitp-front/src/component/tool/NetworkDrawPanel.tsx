import React, { useEffect, useRef, useState } from 'react';
import { getActiveVersionId } from "@utils/versionId";
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useSignalStore } from '@stores/useSignalStore';
import { useBusStationStore } from '@stores/useBusStationStore';
import { useRailStationStore } from '@stores/useRailStationStore';
import { useScenarioStore } from '@stores/useScenarioStore';
import { useMessageStore } from '@stores/useMessageStore';
import { createIntersectionAtNode, autoGenerateAllIntersections, detectAndSplitIntersections } from '@hooks/useNetworkDraw';
import { assignPropertyToResponseData, generateGUIDWithType } from '@utils/guid';
import { autoSaveChangedLayers } from '@utils/autoSave';
import { generateDummySignals } from '@utils/signal';
import { createEventHandlers } from '@handler/createEventHandlers';
import { useEditGuideStore } from '@stores/useEditGuideStore';
import { useMapStore } from '@stores/useMapStore';
import { useBackgroundTaskStore } from '@stores/useBackgroundTaskStore';
import NetworkSelectPanel from './NetworkSelectPanel';
import styles from '@css/ToolsPanel.module.css';

const NetworkDrawPanel: React.FC = () => {
    const {
        isActive, isSelectActive, isConnectionActive, placementMode,
        laneCount, linkWidth, maxSpd, isBidirectional,
        setActive, setSelectActive, setConnectionActive, setPlacementMode,
        setLaneCount, setLinkWidth, setMaxSpd, setBidirectional,
    } = useNetworkDrawStore();

    const [showShortcuts, setShowShortcuts] = useState(false);
    const cleanupRef = useRef<(() => void) | null>(null);
    const prevMapViewModeRef = useRef<string>('split');

    const toggle       = () => setActive(!isActive);
    const toggleSelect = () => setSelectActive(!isSelectActive);
    const toggleConn   = () => setConnectionActive(!isConnectionActive);

    // (구) 편집 진입 시 mapViewMode='2D' 강제 로직 제거 — 이제 편집모드는 split(2D 편집 + 3D 로드뷰)라
    //   강제 2D 전환이 로드뷰를 끄고 불편했음. 편집은 어차피 2D(OL) 전용(NETWORK_EDIT_2D_ONLY)이므로
    //   뷰 모드를 강제할 필요 없음.
    const isDrawEditActive = isActive || placementMode !== 'none';

    // 시설물 배치 모드 활성화: createEventHandlers 등록 + 완료 시 자동 해제
    useEffect(() => {
        if (placementMode === 'none') {
            cleanupRef.current?.();
            cleanupRef.current = null;
            return;
        }

        const featureTypeMap = {
            busStation: 'busStations',
            railStation: 'railStations',
            signal: 'signals',
        } as const;
        const featureType = featureTypeMap[placementMode];
        const guid = generateGUIDWithType(featureType);

        const placementLabel = { busStation: '버스 정류장', railStation: '철도역', signal: '신호등' }[placementMode];
        useEditGuideStore.getState().setGuide({
            title: `시설물 배치 — ${placementLabel}`,
            steps: [
                { keys: ['클릭'], text: `지도에서 ${placementLabel}을(를) 놓을 위치를 클릭하세요`, em: true },
                { keys: ['ESC'], text: '배치 취소' },
            ],
            tip: '배치 후 속성 창에서 상세 정보를 수정할 수 있어요.',
        });

        const record: Record<string, any> = { featureType, __guid: guid, id: Date.now() };
        if (placementMode === 'signal') {
            record.turning = 'Straight';
            record.type = 'TrafficLight';
        }

        // createEventHandlers 등록 (one-shot)
        const handlerCleanup = createEventHandlers(record);

        // 대상 스토어 구독: 새 항목이 추가되면 배치 모드 종료
        const targetStore = { busStation: useBusStationStore, railStation: useRailStationStore, signal: useSignalStore }[placementMode];
        const getCount = (data: any) => Object.values(data ?? {}).flat().length;
        const prevCount = getCount(targetStore.getState().currentJsonData);
        const unsubscribe = (targetStore as any).subscribe(
            (state: any) => state.currentJsonData,
            (data: any) => {
                if (getCount(data) > prevCount) setPlacementMode('none');
            },
            { equalityFn: (a: any, b: any) => a === b }
        );

        cleanupRef.current = () => {
            handlerCleanup?.();
            unsubscribe();
            useEditGuideStore.getState().clear();
        };

        return () => {
            cleanupRef.current?.();
            cleanupRef.current = null;
        };
    }, [placementMode]);

    // ESC 키로 배치 모드 취소
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && placementMode !== 'none') setPlacementMode('none');
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [placementMode]);

    // ⚠️ 아래 3개 핸들러(교차로 재생성/교차 감지/더미 신호 생성)는 전부 currentJsonData만
    //   대상으로 한다 — 상시 타일 모드에서 이는 "현재 화면에 로드된 도로"일 뿐, 부천시 같은
    //   대도시 전역이 아니다. 화면을 나눠 그린 뒤 마지막에 한 번만 누르면 화면 밖 지역은
    //   처리되지 않으므로, 결과 메시지에 항상 "화면에 로드된 범위만" 임을 명시한다.
    //
    //   화면에 로드된 도로가 많으면(대도시 뷰포트) 이 계산 자체가 눈에 띄게 걸릴 수 있는데,
    //   이 3개 버튼 다 처리 중임을 표시하는 상태가 없어 진행 중에도 다시 누를 수 있었다
    //   (중복 실행 → 결과 중복/경쟁). 하나의 busy 플래그로 셋 다 처리 중엔 비활성화한다.
    const [busyAction, setBusyAction] = useState<null | 'intersections' | 'split' | 'signals'>(null);
    // KTDB 가져오기 백그라운드 스캐폴딩(백엔드가 signal.xml/OD를 직접 재생성 중)과 겹치면
    // 프론트/백엔드가 같은 신호 데이터를 서로 다른 경로로 동시에 써서 덮어쓸 수 있다.
    const ktdbScaffolding = useBackgroundTaskStore((s) => !!s.tasks['ktdb-scaffold']);

    const handleAutoAllIntersections = () => {
        if (busyAction) return;
        setBusyAction('intersections');
        try {
            const { count, signalsCleared } = autoGenerateAllIntersections();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: `화면에 로드된 교차로 재생성 완료 (${count}개 노드) — 화면 밖 지역은 해당 지역을 보면서 다시 실행하세요`
                    + (signalsCleared > 0 ? ` · 신호 ${signalsCleared}개의 커넥션 참조 초기화` : ''),
            });
        } finally {
            setBusyAction(null);
        }
    };

    const handleDetectSplit = () => {
        if (busyAction) return;
        setBusyAction('split');
        try {
            const { created, signalsCleared } = detectAndSplitIntersections();
            useMessageStore.getState().setMessage({
                type: 'info',
                text: created > 0
                    ? `화면에 로드된 범위에서 교차 감지 → ${created}개 교차로 자동 생성됨${signalsCleared > 0 ? ` · 신호 ${signalsCleared}개의 커넥션 참조 초기화` : ''}`
                    : '화면에 로드된 범위에는 교차 지점 없음',
            });
        } finally {
            setBusyAction(null);
        }
    };

    const handleGenerateDummySignals = async () => {
        if (busyAction) return;
        if (ktdbScaffolding) {
            useMessageStore.getState().setMessage({
                type: 'warn',
                text: '서버가 백그라운드에서 신호/OD 데이터를 생성 중입니다 — 완료 후 다시 시도하세요.',
            });
            return;
        }
        setBusyAction('signals');
        try {
            const network = useNetworkStore.getState().currentJsonData;
            if (!network?.nodes?.length) {
                useMessageStore.getState().setMessage({ type: 'warn', text: '네트워크 데이터가 없습니다.' });
                return;
            }

            const signals = generateDummySignals(network);
            const signalData = { signals };
            assignPropertyToResponseData(signalData);
            useSignalStore.getState().setCurrentJsonData(signalData);
            useSignalStore.getState().setChange(true);

            // 자동 저장
            const versionKey = getActiveVersionId();
            if (versionKey) await autoSaveChangedLayers(versionKey);

            useMessageStore.getState().setMessage({
                type: 'info',
                text: `화면에 로드된 범위의 더미 신호 생성 완료 (${signals.length}개) — 화면 밖 지역은 해당 지역을 보면서 다시 실행하세요`,
            });
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <>
            <div className={styles.panelHeader}>
                <span className={styles.tab} style={{ color: '#7aa2ff', fontWeight: 600, cursor: 'default' }}>
                    도로 편집
                </span>
            </div>

            <div className={styles.panelBody}>

                {/* ── 모드 버튼 ──────────────────────────────── */}
                <button
                    className={isActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggle}
                    title={isActive ? '그리기 중지 (ESC)' : '도로 그리기 시작'}
                >
                    <span className={styles.measureIcon}>{isActive ? '■' : '✏'}</span>
                    {isActive ? '그리기 중지' : '도로 그리기'}
                </button>

                {isActive && (
                    <HintBox color="blue">
                        클릭 → 시작점<br />
                        이동 → 미리보기 · 클릭 → 구간 완성<br />
                        <span style={{ color: '#ffb347' }}>Shift → 각도 잠금</span> · <span style={{ color: '#ffb347' }}>Alt → 스냅 해제</span><br />
                        우클릭/ESC → 취소
                    </HintBox>
                )}

                <button
                    className={isSelectActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggleSelect}
                    title={isSelectActive ? '선택 모드 종료 (ESC)' : '선택·편집'}
                >
                    <span className={styles.measureIcon}>{isSelectActive ? '■' : '↖'}</span>
                    {isSelectActive ? '선택 종료' : '선택·편집'}
                </button>

                {isSelectActive && (
                    <HintBox color="cyan">
                        클릭 → 선택 · Shift+클릭 → 다중<br />
                        <span style={{ color: '#ffb347' }}>핸들 드래그 → 꼭짓점/노드 이동</span><br />
                        Ctrl+드래그(빈 곳) → 범위 선택<br />
                        <span style={{ color: '#aaa' }}>Delete → 삭제 · ESC → 해제</span>
                    </HintBox>
                )}

                <button
                    className={isConnectionActive ? styles.measureBtnActive : styles.measureBtn}
                    onClick={toggleConn}
                    title={isConnectionActive ? '커넥션 편집 종료 (ESC)' : '교차로 커넥션(회전 동선) 수동 편집'}
                >
                    <span className={styles.measureIcon}>{isConnectionActive ? '■' : '⬡'}</span>
                    {isConnectionActive ? '커넥션 편집 종료' : '커넥션 편집'}
                </button>

                {isConnectionActive && (
                    <HintBox color="blue">
                        교차로 클릭 → 차선 점 표시<br />
                        <span style={{ color: '#ffb347' }}>빨강→파랑 드래그 → 연결</span> · ALL → 일괄<br />
                        <span style={{ color: '#aaa' }}>[A] 자동완성 · 화살표 클릭 → 삭제</span>
                    </HintBox>
                )}

                {/* 선택 요소 편집 패널 */}
                {isSelectActive && <NetworkSelectPanel />}

                <div className={styles.sectionDivider} />

                {/* ── 도로 설정 ──────────────────────────────── */}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, padding: '0 2px' }}>도로 기본값</div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>양방향</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={isBidirectional}
                            onChange={e => setBidirectional(e.target.checked)}
                            style={{ accentColor: '#7aa2ff', width: 14, height: 14 }}
                        />
                        <span className={styles.settingValue}>{isBidirectional ? '상하행 자동' : '단방향'}</span>
                    </label>
                </div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>차선 수</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => setLaneCount(Math.max(1, laneCount - 1))} style={counterBtnStyle}>−</button>
                        <span className={styles.settingValue} style={{ minWidth: 20, textAlign: 'center' }}>{laneCount}</span>
                        <button onClick={() => setLaneCount(Math.min(8, laneCount + 1))} style={counterBtnStyle}>+</button>
                    </div>
                </div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>도로 폭</span>
                    <input
                        type="number" min={2} max={40} step={0.5}
                        value={linkWidth}
                        onChange={e => setLinkWidth(Number(e.target.value))}
                        style={inputStyle}
                    />
                </div>

                <div className={styles.settingRow}>
                    <span className={styles.settingLabel}>제한속도</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="range" min={10} max={110} step={10}
                            value={maxSpd}
                            onChange={e => setMaxSpd(Number(e.target.value))}
                            className={styles.settingRange}
                        />
                        <span className={styles.settingValue} style={{ minWidth: 42 }}>{maxSpd} km/h</span>
                    </div>
                </div>

                <div className={styles.sectionDivider} />

                {/* ── 시설물 배치 ────────────────────────────── */}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, padding: '0 2px' }}>시설물 배치</div>

                <button
                    className={placementMode === 'busStation' ? styles.measureBtnActive : styles.measureBtn}
                    onClick={() => setPlacementMode(placementMode === 'busStation' ? 'none' : 'busStation')}
                    title="차선(노란 면)을 클릭하여 버스정류장 배치"
                >
                    <span className={styles.measureIcon}>{placementMode === 'busStation' ? '■' : '🚌'}</span>
                    {placementMode === 'busStation' ? '배치 중지' : '버스정류장 배치'}
                </button>
                {placementMode === 'busStation' && (
                    <HintBox color="orange">
                        차선(노란 면)을 클릭 → 정류장 배치<br />
                        <span style={{ color: '#aaa' }}>ESC 또는 버튼 재클릭 → 취소</span>
                    </HintBox>
                )}

                <button
                    className={placementMode === 'railStation' ? styles.measureBtnActive : styles.measureBtn}
                    onClick={() => setPlacementMode(placementMode === 'railStation' ? 'none' : 'railStation')}
                    title="지도를 클릭하여 지하철 정류장 배치"
                >
                    <span className={styles.measureIcon}>{placementMode === 'railStation' ? '■' : '🚇'}</span>
                    {placementMode === 'railStation' ? '배치 중지' : '지하철정류장 배치'}
                </button>
                {placementMode === 'railStation' && (
                    <HintBox color="orange">
                        지도 위 원하는 위치 클릭 → 정류장 배치<br />
                        <span style={{ color: '#aaa' }}>ESC 또는 버튼 재클릭 → 취소</span>
                    </HintBox>
                )}

                <button
                    className={placementMode === 'signal' ? styles.measureBtnActive : styles.measureBtn}
                    onClick={() => setPlacementMode(placementMode === 'signal' ? 'none' : 'signal')}
                    title="교차로 노드를 클릭하여 신호 배치"
                >
                    <span className={styles.measureIcon}>{placementMode === 'signal' ? '■' : '🚦'}</span>
                    {placementMode === 'signal' ? '배치 중지' : '신호 배치'}
                </button>
                {placementMode === 'signal' && (
                    <HintBox color="orange">
                        교차로 정지선(in 포트)을 클릭 → 신호 배치<br />
                        <span style={{ color: '#aaa' }}>노드 클릭도 가능 · ESC → 취소</span>
                    </HintBox>
                )}

                <div className={styles.sectionDivider} />

                {/* ── 교차로 일괄 처리 ───────────────────────── */}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, padding: '0 2px' }}>교차로 자동 처리</div>
                <div style={{ fontSize: 9, color: '#777', marginBottom: 6, padding: '0 2px' }}>
                    ⓘ 아래 3개 버튼은 현재 화면에 로드된 도로만 처리합니다 (전체 도시 대상 아님)
                </div>

                <button style={{ ...utilBtnStyle, opacity: busyAction ? 0.6 : 1 }}
                    onClick={handleAutoAllIntersections} disabled={!!busyAction}
                    title="현재 화면에 로드된, in/out 포트가 모두 있는 노드의 connection을 자동 재생성 (화면 밖은 제외)">
                    {busyAction === 'intersections' ? '처리 중...' : '⬡ 화면 내 교차로 재생성'}
                </button>

                <button style={{ ...utilBtnStyle, marginTop: 4, color: '#ffb347', borderColor: 'rgba(255,180,70,0.3)', background: 'rgba(255,180,70,0.06)', opacity: busyAction ? 0.6 : 1 }}
                    onClick={handleDetectSplit} disabled={!!busyAction}
                    title="현재 화면에 로드된 범위에서 겹치는 도로 선분을 감지하여 교차로를 자동으로 분할·생성 (화면 밖은 제외)">
                    {busyAction === 'split' ? '처리 중...' : '✂ 화면 내 교차 감지 → 분할'}
                </button>

                <button style={{ ...utilBtnStyle, marginTop: 4, color: '#a0d8a0', borderColor: 'rgba(100,200,100,0.3)', background: 'rgba(100,200,100,0.06)', opacity: (busyAction || ktdbScaffolding) ? 0.6 : 1 }}
                    onClick={handleGenerateDummySignals} disabled={!!busyAction || ktdbScaffolding}
                    title={ktdbScaffolding
                        ? '서버가 백그라운드에서 신호/OD 데이터를 생성 중입니다'
                        : '현재 화면에 로드된 intersection 노드의 connection 기반으로 더미 신호 데이터 생성 (화면 밖은 제외)'}>
                    {busyAction === 'signals' ? '생성 중...' : ktdbScaffolding ? '서버 생성 중...' : '🚦 화면 내 더미 신호 생성'}
                </button>

                <div className={styles.sectionDivider} />

                {/* ── 단축키 ─────────────────────────────────── */}
                <button
                    onClick={() => setShowShortcuts(v => !v)}
                    style={shortcutToggleStyle}
                >
                    <span>⌨ 단축키</span>
                    <span style={{ fontSize: 10 }}>{showShortcuts ? '▲' : '▼'}</span>
                </button>

                {showShortcuts && (
                    <div style={{ marginTop: 4, padding: '6px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)', fontSize: 10, color: '#555' }}>
                        {SHORTCUTS.map(([key, desc]) => (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, lineHeight: 1.9 }}>
                                <span style={{ color: '#7aa2ff', background: 'rgba(122,162,255,0.08)', padding: '0 4px', borderRadius: 3, fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{key}</span>
                                <span style={{ color: '#666', textAlign: 'right' }}>{desc}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};

// ── 힌트 박스 ────────────────────────────────────────────────────
const HintBox: React.FC<{ color: 'blue' | 'cyan' | 'orange'; children: React.ReactNode }> = ({ color, children }) => {
    const colors = {
        blue:   { bg: 'rgba(65,105,225,0.08)',    border: 'rgba(65,105,225,0.25)',    text: '#7aa2ff' },
        cyan:   { bg: 'rgba(100,180,255,0.06)',   border: 'rgba(100,180,255,0.2)',    text: '#64b4ff' },
        orange: { bg: 'rgba(255,160,50,0.08)',    border: 'rgba(255,160,50,0.25)',    text: '#ffb347' },
    };
    const c = colors[color];
    return (
        <div style={{
            padding: '7px 10px', background: c.bg, borderRadius: 6,
            border: `1px solid ${c.border}`, marginBottom: 8,
            fontSize: 11, color: c.text, lineHeight: 1.7,
        }}>
            {children}
        </div>
    );
};

// ── 단축키 목록 ─────────────────────────────────────────────────
const SHORTCUTS: [string, string][] = [
    ['Ctrl+Z',         '실행 취소 (50단계)'],
    ['Ctrl+Shift+Z',   '다시 실행'],
    ['더블클릭',       '이어 그리기 체인 종료'],
    ['ESC',            '취소 / 선택 해제'],
    ['Delete',         '선택 요소 삭제'],
    ['Shift',          '각도 잠금 (그리기)'],
    ['Shift+클릭',     '다중 선택 토글'],
    ['핸들 드래그',    '꼭짓점/노드 이동 (선택 후)'],
    ['Ctrl+박스드래그', '범위 선택'],
];

// ── 스타일 ──────────────────────────────────────────────────────
const counterBtnStyle: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#aaa', fontSize: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
};
const inputStyle: React.CSSProperties = {
    width: 60, background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 4, color: '#ccc', fontSize: 12,
    padding: '2px 6px', textAlign: 'right',
};
const utilBtnStyle: React.CSSProperties = {
    width: '100%', padding: '7px 12px',
    background: 'rgba(122,162,255,0.07)',
    border: '1px solid rgba(122,162,255,0.22)',
    borderRadius: 5, color: '#7aa2ff', fontSize: 11,
    cursor: 'pointer', textAlign: 'left',
};
const shortcutToggleStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 5, color: '#666', fontSize: 11,
    cursor: 'pointer', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
};

export default NetworkDrawPanel;
