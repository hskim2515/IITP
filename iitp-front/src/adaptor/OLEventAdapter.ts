import { EventAdapter } from '@adaptor/EventAdapter';
import { Feature, Map as OLMap, MapBrowserEvent } from 'ol';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Draw, Modify, Select, Snap } from 'ol/interaction';
import { unByKey } from 'ol/Observable';
import { EventOptions } from "@type/EventOptions";
import GeometryType from "@type/FeatureOptions";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import Collection from "ol/Collection";

type InteractionType = 'draw' | 'modify' | 'select' | 'snap';
type OLInteraction = Draw | Modify | Select | Snap;

export class OLEventAdapter implements EventAdapter {
    private map: OLMap;
    private mapHandlers: Map<string, (e: MapBrowserEvent<any>) => void> = new Map();
    private interactionMap: Map<InteractionType, OLInteraction> = new Map();
    private interactionHandlers: Map<string, any> = new Map();
    private interactionLayerMap: Map<InteractionType, VectorLayer> = new Map();

    constructor(map: OLMap) {
        this.map = map;
    }

    register(eventType: string, callback: (event: any) => void, options?: EventOptions): void {
        const interactionType = this.getInteractionType(eventType);

        if (!interactionType) {
            // 기본 Map 이벤트
            const handler = (e: MapBrowserEvent<any>) => callback(e);
            this.map.on(eventType, handler);
            this.mapHandlers.set(eventType, handler);
            return;
        }

        // Interaction 이벤트
        if(!options) return;
        const interaction = this.getOrCreateInteraction(interactionType, options);

        this.map.addInteraction(interaction);
        this.interactionMap.set(interactionType, interaction);
        const key = interaction.on(eventType, (e) => callback(e));
        this.interactionHandlers.set(eventType, key);

        console.log('[register] interaction:', interactionType, 'eventType:', eventType, 'key:', key);
    }

    unregister(eventType: string): void {
        console.log("[register] interaction [unregister]")
        const interactionType = this.getInteractionType(eventType);

        if (!interactionType) {
            // Map 이벤트
            const handler = this.mapHandlers.get(eventType);
            if (handler) {
                this.map.un(eventType, handler);
                this.mapHandlers.delete(eventType);
            }
            return;
        }

        // Interaction 이벤트
        const key = this.interactionHandlers.get(eventType);
        const olInteraction = this.interactionMap.get(interactionType)
        if (key && olInteraction) {
            unByKey(key);
            this.interactionHandlers.delete(eventType);
            // this.mapHandlers.delete(eventType)
            this.interactionMap.delete(interactionType)
            this.map.removeInteraction(olInteraction)
        }


    }

    private getInteractionType(eventType: string): InteractionType | null {
        if (eventType.startsWith('draw')) return 'draw';
        if (eventType.startsWith('modify')) return 'modify';
        if (eventType === 'select') return 'select';
        if (eventType === 'snap') return 'snap';
        return null;
    }

    private getOrCreateInteraction(type: InteractionType, options: EventOptions): OLInteraction {
        if (this.interactionMap.has(type)) return this.interactionMap.get(type)!;
        let interaction: OLInteraction;
        switch (type) {
            case 'draw': {
                const geometryType = options.drawGeometryType || GeometryType.POINT
                // this.attachLayer(type, source)
                interaction = new Draw({
                    type: geometryType,
                });
                break;
            }
            case 'modify': {
                const rawFeatures = options.features;

                // Feature[]를 Collection으로 감싸기
                const featuresCollection = Array.isArray(rawFeatures)
                    ? new Collection<Feature>(rawFeatures)
                    : rawFeatures;

                interaction = new Modify({
                    features: featuresCollection,
                    wrapX: false,
                    style: new Style({
                        image: new CircleStyle({
                            radius: 8,
                            fill: new Fill({ color: "rgba(0,255,0,1)" }),
                            stroke: new Stroke({ color: "rgba(255,0,0,0)", width: 1 }),
                        }),
                    })
                });
                break;
            }
            case 'select': {
                interaction = new Select({
                    layers: options.olLayers,
                });
                break;
            }
            case 'snap': {
                const source = options.olLayer?.getSource();
                interaction = new Snap({
                    source
                });
                break;
            }
        }

        console.log("interaction:::", interaction)
        return interaction;
    }
    // 추후 redo&undo 에 활용
    private attachLayer(type: InteractionType, source: VectorSource) {
        const layer = new VectorLayer({
            source,
            zIndex: 1200
        });
        this.map.addLayer(layer);
        this.interactionLayerMap.set(type, layer);
    }
}
