import { MapBrowserEvent } from "ol";
import { InteractionCondition } from "@type/InteractionOptions";
import { OpenLayersScreenSpaceEventType } from "@type/OpenLayersKeyOptions";

/**
 * Openlayers Interaction 의 condition 을 설정
 *
 * @param condition 키보드, 마우스 버튼 값을 포함한 객체
 */
export const setInteractionCondition = (
    condition: InteractionCondition = { button: OpenLayersScreenSpaceEventType.LEFT_CLICK } // LEFT_CLICK 을 default 로
) => (event: MapBrowserEvent<UIEvent>) =>
    matchCondition(event.originalEvent as MouseEvent, condition);

/**
 * 입력된 condition 이 있으면, MouseEvent condition 과 비교
 *
 * @param original MouseEvent condition
 * @param condition 사용자 입력 condition
 */
function matchCondition(
    original: MouseEvent,
    condition: InteractionCondition
): boolean {
    return (
        (condition.ctrlKey === undefined || original.ctrlKey === condition.ctrlKey) &&
        (condition.shiftKey === undefined || original.shiftKey === condition.shiftKey) &&
        (condition.altKey === undefined || original.altKey === condition.altKey) &&
        (condition.button === undefined || original.button === condition.button)
    );
}