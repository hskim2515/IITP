import { create } from 'zustand';
import { EventManager, EventType, EventCallback } from '@managers/EventManager';

type MapType = 'cesium' | 'ol';

type EventStore = {
    cesiumEventManager: EventManager | null;
    olEventManager: EventManager | null;
    activeMap: MapType;
    setCesiumManager: (manager: EventManager) => void;
    setOlManager: (manager: EventManager) => void;
    setActiveMap: (map: MapType) => void;
    bind: (type: EventType, cb: EventCallback) => void;
    unbind: (type: EventType, cb: EventCallback) => void;
    clearAll: () => void;
};

export const useEventStore = create<EventStore>((set, get) => ({
    cesiumEventManager: null,
    olEventManager: null,
    activeMap: 'cesium', // 기본값

    setCesiumManager: (manager) => set({ cesiumEventManager: manager }),
    setOlManager: (manager) => set({ olEventManager: manager }),
    setActiveMap: (map) => set({ activeMap: map }),

    bind: (type, cb) => {
        const { activeMap, cesiumEventManager, olEventManager } = get();
        const manager = activeMap === 'cesium' ? cesiumEventManager : olEventManager;
        manager?.register(type, cb);
    },
    unbind: (type, cb) => {
        const { activeMap, cesiumEventManager, olEventManager } = get();
        const manager = activeMap === 'cesium' ? cesiumEventManager : olEventManager;
        manager?.unregister(type, cb);
    },
    clearAll: () => {
        const { cesiumEventManager, olEventManager } = get();
        cesiumEventManager?.clear();
        olEventManager?.clear();
    },
}));
