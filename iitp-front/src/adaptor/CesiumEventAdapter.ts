import { EventAdapter } from './EventAdapter';
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Viewer } from 'cesium';

export class CesiumEventAdapter implements EventAdapter {
    private handler: ScreenSpaceEventHandler;
    // 여러 논리적 eventType(예: 'select', 'singleclick')이 동일한 Cesium
    // ScreenSpaceEventType(예: LEFT_CLICK)을 공유할 수 있으므로, 슬롯별로
    // 등록 스택을 유지한다. 가장 최근에 register된 콜백이 슬롯을 점유하고,
    // unregister 시에는 슬롯 자체를 파괴하지 않고 그 이전 콜백으로 복원한다.
    private stacks: Map<ScreenSpaceEventType, { eventType: string; callback: (event: any) => void }[]> = new Map();

    constructor(viewer: Viewer) {
        this.handler = new ScreenSpaceEventHandler(viewer.canvas);
    }

    register(eventType: string, callback: (event: any) => void): void {
        const translated = this.translate(eventType);
        const stack = this.stacks.get(translated) ?? [];
        const existingIndex = stack.findIndex(entry => entry.eventType === eventType);
        if (existingIndex !== -1) {
            stack.splice(existingIndex, 1);
        }
        stack.push({ eventType, callback });
        this.stacks.set(translated, stack);
        this.handler.setInputAction(callback, translated);
    }

    unregister(eventType: string): void {
        const translated = this.translate(eventType);
        const stack = this.stacks.get(translated);
        if (!stack) return;
        const index = stack.findIndex(entry => entry.eventType === eventType);
        if (index === -1) return;
        stack.splice(index, 1);
        if (stack.length === 0) {
            this.handler.removeInputAction(translated);
            this.stacks.delete(translated);
        } else {
            const top = stack[stack.length - 1];
            if (top) this.handler.setInputAction(top.callback, translated);
        }
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
