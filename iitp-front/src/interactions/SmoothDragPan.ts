import DragPan from 'ol/interaction/DragPan';
import type MapBrowserEvent from 'ol/MapBrowserEvent';

/**
 * 기본 DragPan의 모든 동작(관성, 멀티터치 등)을 유지하되,
 * ViewHint.INTERACTING 플래그를 이벤트 처리 후 즉시 0으로 되돌린다.
 *
 * OL은 INTERACTING 플래그가 켜져 있는 동안 레이어 렌더를 CSS transform 패스스루로
 * 대체하여 WebGL 버퍼 재빌드를 스킵한다. 이를 억제함으로써 드래그 중에도
 * VehicleFeatureLayer 등 WebGL 레이어가 매 프레임 정상적으로 업데이트된다.
 */
export class SmoothDragPan extends DragPan {
    override handleEvent(evt: MapBrowserEvent<PointerEvent>): boolean {
        const result = super.handleEvent(evt);
        // hints_[1] = ViewHint.INTERACTING
        // endInteraction()이 -1로 만들 수 있으므로 Math.max(0, ...) 로 고정
        // hints_[1] = ViewHint.INTERACTING
        // beginInteraction()이 1로, endInteraction()이 -1로 만들 수 있으므로 항상 0으로 고정
        const hints = (evt.map.getView() as any).hints_ as number[] | undefined;
        if (hints) hints[1] = 0;
        return result;
    }
}