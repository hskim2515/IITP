import { EventManager, EventType, EventCallback } from '@managers/EventManager';
import * as Cesium from "cesium";


export class CesiumEventManager implements EventManager {
    private callbacks: Map<EventType, Set<EventCallback>> = new Map();

    constructor(private viewer: Cesium.Viewer) {}

    register(event: EventType, callback: EventCallback) {
        if (!this.callbacks.has(event)) this.callbacks.set(event, new Set());
        this.callbacks.get(event)!.add(callback);
        // Cesium-specific event binding (예시)
        if (event === 'select') {
            this.viewer.screenSpaceEventHandler.setInputAction(callback, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        }
    }

    unregister(event: EventType, callback: EventCallback) {
        this.callbacks.get(event)?.delete(callback);
        // TODO: Cesium-specific 해제 로직
    }

    clear() {
        this.callbacks.clear();
        this.viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
}
