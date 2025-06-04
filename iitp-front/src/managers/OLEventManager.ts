import { EventManager, EventType, EventCallback } from '@managers/EventManager';
import Map from 'ol/Map';

export class OLEventManager implements EventManager {
    private callbacks: Map<EventType, Set<EventCallback>> = new Map();

    constructor(private map: Map) {}

    register(event: EventType, callback: EventCallback) {
        if (!this.callbacks.has(event)) this.callbacks.set(event, new Set());
        this.callbacks.get(event)!.add(callback);

        if (event === 'select') {
            this.map.on('singleclick', callback);
        }
    }

    unregister(event: EventType, callback: EventCallback) {
        this.map.un(event, callback);
        this.callbacks.get(event)?.delete(callback);
    }

    clear() {
        for (const [event, cbs] of this.callbacks.entries()) {
            cbs.forEach(cb => this.map.un(event, cb));
        }
        this.callbacks.clear();
    }
}
