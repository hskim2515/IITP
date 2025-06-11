import GeometryType from "@features/GeometryType";
import { Feature, Map as OlMap } from "ol";
import { DrawEvent } from "ol/interaction/Draw";
import { SelectEvent } from "ol/interaction/Select";
import { OpenLayersScreenSpaceEventType } from "@type/OpenLayersKeyOptions";
import { ModifyEvent } from "ol/interaction/Modify";
import Interaction from "ol/interaction/Interaction";

export interface LayerRefOption {
    layerName: string;
}

// snap은 Condition이 필요 없는 Interaction이라 분리함
export interface BaseInteractionOption extends LayerRefOption {
    condition: InteractionCondition;
}

export interface DrawInteractionOption extends BaseInteractionOption {
    drawGeometryType: GeometryType;
    onDrawStart?: (e: DrawEvent) => Feature;
    onDrawEnd?: (e: DrawEvent) => Feature;
}

export interface SelectInteractionOption extends BaseInteractionOption {
    onSelect?: (e: SelectEvent) => Feature[];
}

export interface ModifyInteractionOption extends BaseInteractionOption {
    onModifyStart?: (e: ModifyEvent) => Feature[];
    onModifyEnd?: (e: ModifyEvent) => Feature[];
}

export type SnapInteractionOption = LayerRefOption;

export interface InteractionCondition {
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    button?: OpenLayersScreenSpaceEventType;
}

// 각 Interaction 에서 사용될 메서드
export interface InteractionEventOptions {
    activate: (map: OlMap) => void;
    deactivate: (map: OlMap) => void;
    getInteraction: () => Interaction;
}
