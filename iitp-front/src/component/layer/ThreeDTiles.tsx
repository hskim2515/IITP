import React, { useEffect, useState } from 'react';
import { use3DTilesStore } from '@stores/use3DTilesStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import { LayerField } from '@stores/useLayerSchemaStore';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import styles from '@css/ToolsPanel.module.css';

export interface Props {
    fields: LayerField[];
}

const ThreeDTiles = (_props: Props) => {
    const tilesets = use3DTilesStore.state.tilesets();
    const loaded = use3DTilesStore.state.loaded();
    const { setTilesetEnabled, fetchTilesets, createTileset, deleteTileset } = use3DTilesStore.getState();
    const viewer = useCesiumStore.state.viewer();

    const [showAddForm, setShowAddForm] = useState(false);
    const [labelInput, setLabelInput] = useState('');
    const [urlsInput, setUrlsInput] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!loaded) fetchTilesets();
    }, [loaded]);

    const handleToggle = (id: number, enabled: boolean) => {
        setTilesetEnabled(id, enabled, viewer ?? undefined);
    };

    const handleDelete = (e: React.MouseEvent, id: number) => {
        e.preventDefault(); // label 기본 동작(체크박스 토글) 방지
        deleteTileset(id).catch(() => setError('삭제에 실패했습니다.'));
    };

    // 전국 데이터처럼 tileset.json 이 지역별로 여러 개로 나뉜 경우를 한 그룹(라벨)으로
    // 묶어 등록 — 줄바꿈으로 구분된 URL을 전부 urls[] 에 담아 한 번에 켜고 끌 수 있게 한다.
    const handleAdd = async () => {
        const label = labelInput.trim();
        const urls = urlsInput.split('\n').map(u => u.trim()).filter(Boolean);
        if (!label) { setError('이름을 입력해 주세요.'); return; }
        if (urls.length === 0) { setError('tileset.json URL을 한 줄에 하나씩 입력해 주세요.'); return; }
        setSubmitting(true);
        setError(null);
        try {
            await createTileset(label, urls);
            setLabelInput('');
            setUrlsInput('');
            setShowAddForm(false);
        } catch {
            setError('등록에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            {tilesets.map(entry => (
                <label key={entry.id} className={styles.layerItem}>
                    <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={e => handleToggle(entry.id, e.target.checked)}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                        {entry.label}
                    </span>
                    <span className={styles.layerItemMeta}>{entry.urls.length}개</span>
                    <button
                        onClick={(e) => handleDelete(e, entry.id)}
                        className={styles.layerItemDeleteBtn}
                        title="삭제"
                    >
                        <FontAwesomeIcon icon={faTrash} size="sm" />
                    </button>
                </label>
            ))}
            {tilesets.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 4px' }}>
                    등록된 3D Tiles가 없습니다.
                </div>
            )}

            <button
                className={showAddForm ? styles.measureBtnActive : styles.measureBtn}
                onClick={() => setShowAddForm(v => !v)}
            >
                <FontAwesomeIcon icon={faPlus} className={styles.measureIcon} />
                3D Tiles 추가
            </button>

            {showAddForm && (
                <div className={styles.settingInlinePanel}>
                    <input
                        className={styles.formInput}
                        value={labelInput}
                        onChange={e => setLabelInput(e.target.value)}
                        placeholder="이름 (예: LH 전국 3D Tiles)"
                    />
                    <span className={styles.settingLabel} style={{ display: 'block', padding: '2px 0 4px' }}>
                        tileset.json URL (한 줄에 하나씩)
                    </span>
                    <textarea
                        className={styles.formTextarea}
                        value={urlsInput}
                        onChange={e => setUrlsInput(e.target.value)}
                        placeholder={'https://…/tileset.json'}
                        rows={4}
                    />
                    {error && <span className={styles.formError}>{error}</span>}
                    <div className={styles.formActions}>
                        <button
                            className={styles.formBtnGhost}
                            onClick={() => { setShowAddForm(false); setError(null); }}
                        >취소</button>
                        <button
                            className={styles.formBtnPrimary}
                            onClick={handleAdd}
                            disabled={submitting}
                        >{submitting ? '등록 중...' : '등록'}</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ThreeDTiles;
