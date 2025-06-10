import { Select } from "ol/interaction";
import { Map, MapBrowserEvent } from "ol";
import VectorLayer from "ol/layer/Vector";
import { SelectEvent } from "ol/interaction/Select";
import { InteractionEventOptions } from "@type/InteractionOptions";

export class SelectInteraction implements InteractionEventOptions {
    private interaction: Select;

    constructor(
        private layers: VectorLayer[],
        private condition: (e: MapBrowserEvent<UIEvent>) => boolean,
        private onSelect?: (e: SelectEvent) => void,
    ) {
        this.interaction = new Select({
            layers: this.layers,
            condition: this.condition,
            style: null
        });

        if (this.onSelect) {
            this.interaction.on('select', (e) => {
                e.selected.forEach((feature) => {
                    feature.set('selected', 1); // 선택된 것
                });

                e.deselected.forEach((feature) => {
                    feature.set('selected', 0); // 해제된 것
                });

                this.onSelect?.(e); // 기존 콜백도 실행
            });
        }
    }

    activate(map: Map): void {
        if(this.interaction){
            map.addInteraction(this.interaction);
        }
    }

    deactivate(map: Map): void {
        if(this.interaction) {
            map.removeInteraction(this.interaction);
        }
    }

    getInteraction() {
        if (!this.interaction) throw new Error("Interaction is not initialized");
        return this.interaction;
    }
}
