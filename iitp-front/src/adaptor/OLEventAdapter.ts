import { EventAdapter } from '@adaptor/EventAdapter';
import OLMap from 'ol/Map';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Draw, Modify, Select } from 'ol/interaction';
import { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';

type InteractionType = 'draw' | 'modify' | 'select';
type OLInteraction = Draw | Modify | Select;

export class OLEventAdapter implements EventAdapter {
    private map: Map;
    private mapHandlers: Map<string, (e: MapBrowserEvent<any>) => void> = new Map();
    private interactionMap: Map<InteractionType, OLInteraction> = new Map();
    private interactionHandlers: Map<string, any> = new Map();
    private interactionLayerMap: Map<InteractionType, VectorLayer<VectorSource>> = new Map();

    constructor(map: OLMap) {
        this.map = map;
    }

    register(eventType: string, callback: (event: any) => void): void {
        const interactionType = this.getInteractionType(eventType);

        if (!interactionType) {
            // 기본 Map 이벤트
            const handler = (e: MapBrowserEvent<any>) => callback(e);
            this.map.on(eventType, handler);
            this.mapHandlers.set(eventType, handler);
            return;
        }

        // Interaction 이벤트
        const interaction = this.getOrCreateInteraction(interactionType);
        const key = interaction.on(eventType, callback);
        this.interactionHandlers.set(eventType, key);
    }

    unregister(eventType: string): void {
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
        if (key) {
            unByKey(key);
            this.interactionHandlers.delete(eventType);
        }
    }

    private getInteractionType(eventType: string): InteractionType | null {
        if (eventType.startsWith('draw')) return 'draw';
        if (eventType.startsWith('modify')) return 'modify';
        if (eventType === 'select') return 'select';
        return null;
    }

    private getOrCreateInteraction(type: InteractionType): OLInteraction {
        console.log(this.interactionMap)
        if (this.interactionMap.has(type)) return this.interactionMap.get(type)!;

        let interaction: OLInteraction;

        switch (type) {
            case 'draw': {
                const source = new VectorSource();
                this.attachLayer(type, source);
                interaction = new Draw({
                    type: 'Polygon',
                    source,
                });
                break;
            }
            case 'modify': {
                const source = new VectorSource(); // 실제로는 기존 source를 사용해야 함
                this.attachLayer(type, source);
                interaction = new Modify({ source });
                break;
            }
            case 'select': {
                interaction = new Select();
                break;
            }
        }

        this.map.addInteraction(interaction);
        this.interactionMap.set(type, interaction);
        return interaction;
    }

    private attachLayer(type: InteractionType, source: VectorSource) {
        const layer = new VectorLayer({ source });
        this.map.addLayer(layer);
        this.interactionLayerMap.set(type, layer);
    }
}
