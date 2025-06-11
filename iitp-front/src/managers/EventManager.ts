import { EventAdapter } from "@adaptor/EventAdapter";
import { EventOptions } from "@type/EventOptions";

export type EventType = 'select' | 'modify' | 'delete' | 'add';

type EventCallback = (event: any) => void;

export class EventManager {
    private adapter: EventAdapter;
    private listeners: Map<string, Set<EventCallback>>;

    constructor(adapter: EventAdapter) {
        this.adapter = adapter;
        this.listeners = new Map();
    }

    bind(eventType: string, callback: EventCallback, options?: EventOptions) {
        // 내부 콜백 목록에 등록
        console.log("interaction adapter callback:::", callback)
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
            this.adapter.register(eventType, (e: any) => this.dispatch(eventType, e), options);
            console.log("interaction adapter:::", this.adapter)


        }
        this.listeners.get(eventType)!.add(callback);

    }

    unbind(eventType: string, callback: EventCallback) {
        const set = this.listeners.get(eventType);
        if (set) {
            set.delete(callback);
            console.log("set.keys:::", set.values())
            console.log("set.size:::", set.size)
            if (set.size === 0) {
                this.adapter.unregister(eventType); // 더 이상 필요 없음
                this.listeners.delete(eventType);
            }
        }
    }

    private dispatch(eventType: string, event: any) {
        const callbacks = this.listeners.get(eventType);
        if (callbacks) {
            console.log("interaction callbacks:::", callbacks)
            for (const cb of callbacks) cb(event);
        }
    }

    destroy() {
        for (const eventType of this.listeners.keys()) {
            this.adapter.unregister(eventType);
        }
        this.listeners.clear();
    }
}
