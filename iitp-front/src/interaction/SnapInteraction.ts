import { Snap } from "ol/interaction";
import { Map } from "ol";
import { InteractionEventOptions } from "@type/InteractionOptions";
import VectorSource from "ol/source/Vector";

export class SnapInteraction implements InteractionEventOptions {
    private interaction: Snap;

    constructor(
        source: VectorSource,
    ) {
        this.interaction = new Snap({
            source: source,
            pixelTolerance: 20,
        });
    }

    activate(map: Map): void {
        map.addInteraction(this.interaction);
    }

    deactivate(map: Map): void {
        map.removeInteraction(this.interaction);
    }

    getInteraction(): Snap {
        return this.interaction;
    }
}
