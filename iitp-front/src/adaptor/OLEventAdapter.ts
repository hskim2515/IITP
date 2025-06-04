import { EventAdapter } from '@adaptor/EventAdapter';
import Map from 'ol/Map';
import { MapBrowserEvent } from 'ol';

export class OLEventAdapter implements EventAdapter {
    private map: Map;
    private registered: Map<string, (e: MapBrowserEvent<any>) => void> = new Map();

    constructor(map: Map) {
        this.map = map;
    }

    register(eventType: string, callback: (event: any) => void): void {
        const translated = this.translate(eventType);
        const handler = (e: MapBrowserEvent<any>) => callback(e);
        this.map.on(translated, handler);
        this.registered.set(eventType, handler);
    }

    unregister(eventType: string): void {
        const translated = this.translate(eventType);
        const handler = this.registered.get(eventType);
        if (handler) {
            this.map.un(translated, handler);
            this.registered.delete(eventType);
        }
    }

    private translate(eventType: string): string {
        if (eventType === 'select') return 'singleclick';
        return eventType;
    }
}