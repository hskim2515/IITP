import { Map, MapBrowserEvent } from 'ol';
import { Modify } from 'ol/interaction';
import { ModifyEvent } from "ol/interaction/Modify";
import { Fill, Stroke, Style } from "ol/style";

import VectorLayer from "ol/layer/Vector";
import { InteractionEventOptions } from "@type/InteractionOptions";

// draw 로 생성되는 style과 중복되어서 임시로 투명하게 설정
const invisiblePointDrawStyle = new Style({
    stroke: new Stroke({
        color: 'rgba(0, 0, 0, 0.0)',
        width: 2,
    }),
    fill: new Fill({
        color: 'rgba(0, 0, 0, 0.0)',
    }),
});

export class ModifyInteraction implements InteractionEventOptions {
    private interaction: Modify;

    constructor(
        private layer: VectorLayer,
        private condition: (e: MapBrowserEvent<UIEvent>) => boolean,
        private onModifyStart?: (e: ModifyEvent) => void,
        private onModifyEnd?: (e: ModifyEvent) => void,
    ) {
        this.interaction = new Modify({
            source: this.layer.getSource(),
            // pixelTolerance: 10,
            // style: invisiblePointDrawStyle,
            condition: this.condition,
        });

        if (this.onModifyStart) {
            this.interaction.on('modifystart', this.onModifyStart);
        }

        if (this.onModifyEnd) {
            this.interaction.on('modifyend', this.onModifyEnd);
        }
    }

    activate(map: Map): void {
        map.addInteraction(this.interaction);
    }

    deactivate(map: Map): void {
        map.removeInteraction(this.interaction);
    }

    getInteraction() {
        return this.interaction;
    }
}
