import { Map, MapBrowserEvent } from 'ol';
import Draw, { DrawEvent } from 'ol/interaction/Draw';
import GeometryType from "ol/geom/GeometryType";
import VectorLayer from "ol/layer/Vector";
import { InteractionEventOptions } from "@type/InteractionOptions";
import { Fill, Stroke, Style } from "ol/style";

const invisiblePointDrawStyle = new Style({
    stroke: new Stroke({
        color: 'rgba(0, 0, 0, 0.0)',
        width: 2,
    }),
    fill: new Fill({
        color: 'rgba(0, 0, 0, 0.0)',
    }),
});

export class DrawInteraction implements InteractionEventOptions {
    private interaction: Draw;

    constructor(
        private layer: VectorLayer,
        private geometryType: GeometryType,
        private condition: (e: MapBrowserEvent<UIEvent>) => boolean,
        private onDrawStart?: (e: DrawEvent) => void,
        private onDrawEnd?: (e: DrawEvent) => void,
    ) {
        this.interaction = new Draw({
            source: this.layer.getSource(),
            type: this.geometryType,
            style: invisiblePointDrawStyle,
            condition: this.condition,
        });

        if (this.onDrawStart) {
            this.interaction.on('drawstart', this.onDrawStart);
        }
        if (this.onDrawEnd) {
            this.interaction.on('drawend', this.onDrawEnd);
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
