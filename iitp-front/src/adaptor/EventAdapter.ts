import { EventOptions } from "@type/EventOptions";

export interface EventAdapter {
    register(eventType: string, callback: (event: any) => void, options?: EventOptions): void;
    unregister(eventType: string): void;
}

