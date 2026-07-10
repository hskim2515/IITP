import { useEffect } from 'react';
import { toLonLat } from 'ol/proj';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useMapStore } from '@stores/useMapStore';

export function useCoordPick() {
    const olMap = useOpenLayersStore((s) => s.map);
    const coordPickCallback = useMapStore((s) => s.coordPickCallback);

    useEffect(() => {
        if (!olMap || !coordPickCallback) return;

        const target = olMap.getTargetElement() as HTMLElement;
        target.style.cursor = 'crosshair';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (e: any) => {
            const [lng, lat] = toLonLat(e.coordinate as number[]) as [number, number];
            coordPickCallback(lat, lng);
            useMapStore.getState().cancelCoordPick();
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (olMap as any).once('singleclick', handler);

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') useMapStore.getState().cancelCoordPick();
        };
        window.addEventListener('keydown', onKeyDown);

        return () => {
            target.style.cursor = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (olMap as any).un('singleclick', handler);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [olMap, coordPickCallback]);
}
