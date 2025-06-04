
export interface EventAdapter {
    register(eventType: string, callback: (event: any) => void): void;
    unregister(eventType: string): void;
}

