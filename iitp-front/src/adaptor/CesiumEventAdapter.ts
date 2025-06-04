import { EventAdapter } from './EventAdapter';
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Viewer } from 'cesium';

export class CesiumEventAdapter implements EventAdapter {
    private handler: ScreenSpaceEventHandler;
    private registered: Map<string, () => void> = new Map();

    constructor(viewer: Viewer) {
        this.handler = new ScreenSpaceEventHandler(viewer.canvas);
    }

    register(eventType: string, callback: (event: any) => void): void {
        const translated = this.translate(eventType);
        this.handler.setInputAction(callback, translated);
        this.registered.set(eventType, () => this.handler.removeInputAction(translated));
    }

    unregister(eventType: string): void {
        this.registered.get(eventType)?.();
        this.registered.delete(eventType);
    }

    private translate(eventType: string): ScreenSpaceEventType {
        switch (eventType) {
            case 'click': return ScreenSpaceEventType.LEFT_CLICK;
            case 'rightClick': return ScreenSpaceEventType.RIGHT_CLICK;
            case 'move': return ScreenSpaceEventType.MOUSE_MOVE;
            default: return ScreenSpaceEventType.LEFT_CLICK;
        }
    }
}
