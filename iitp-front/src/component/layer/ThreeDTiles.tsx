import React, { useEffect } from 'react';
import { use3DTilesStore } from '@stores/use3DTilesStore';
import { useCesiumStore } from '@stores/useCesiumStore';
import { LayerField } from '@stores/useLayerSchemaStore';
import styles from '@css/ToolsPanel.module.css';

export interface Props {
    fields: LayerField[];
}

const ThreeDTiles = (_props: Props) => {
    const tilesets = use3DTilesStore.state.tilesets();
    const loaded = use3DTilesStore.state.loaded();
    const { setTilesetEnabled, fetchTilesets } = use3DTilesStore.getState();
    const viewer = useCesiumStore.state.viewer();

    useEffect(() => {
        if (!loaded) fetchTilesets();
    }, [loaded]);

    const handleToggle = (id: number, enabled: boolean) => {
        setTilesetEnabled(id, enabled, viewer ?? undefined);
    };

    return (
        <div>
            {tilesets.map(entry => (
                <label key={entry.id} className={`${styles.layerItem} ${entry.enabled ? styles.layerItemChecked : ''}`}>
                    <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={e => handleToggle(entry.id, e.target.checked)}
                        style={{ accentColor: '#7aa2ff', width: 13, height: 13, cursor: 'pointer' }}
                    />
                    {entry.label}
                </label>
            ))}
            {tilesets.length === 0 && (
                <div style={{ color: '#888', fontSize: 12, padding: '8px 4px' }}>
                    등록된 3D Tiles가 없습니다.
                </div>
            )}
        </div>
    );
};

export default ThreeDTiles;
