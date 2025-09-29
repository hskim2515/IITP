import { EventAdapter } from '@adaptor/EventAdapter';
import { EventOptions } from '@type/EventOptions';
import { Map as OLMap } from 'ol';
import Interaction from 'ol/interaction/Interaction';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Select from 'ol/interaction/Select';
import Translate from 'ol/interaction/Translate';
import Snap from 'ol/interaction/Snap';
import { unByKey } from 'ol/Observable';
import { EventsKey } from 'ol/events';

type InteractionType = 'draw' | 'modify' | 'select' | 'translate' | 'snap';

export class OLEventAdapter implements EventAdapter {
    private olMap: OLMap;
    private registered: Map<string, () => void> = new Map();
    private interactions: Map<string, Interaction> = new Map();

    constructor(olMap: OLMap) {
        this.olMap = olMap;
    }

    register(eventKey: string, callback: (event: any) => void, options?: EventOptions): void {
        const { interactionType, context, phase } = this.parseEventKey(eventKey);

        if (!interactionType) {
            const translated = this.translateMapEvent(eventKey);
            const key: EventsKey = this.olMap.on(translated, callback);
            this.registered.set(eventKey, () => unByKey(key));
            return;
        }

        const interactionKey = this.getInteractionKey(interactionType, context);
        let interaction = this.interactions.get(interactionKey);

        if (!interaction) {
            interaction = this.createInteraction(interactionType, options);
            if (!interaction) return;
            this.olMap.addInteraction(interaction);
            this.interactions.set(interactionKey, interaction);
        }

        const translatedEvents = this.translateInteraction(interactionType, phase);
        translatedEvents.forEach(ev => {
            const key: EventsKey = interaction!.on(ev, callback);
            this.registered.set(`${eventKey}:${ev}`, () => unByKey(key));
        });
    }

    unregister(eventKey: string): void {
        [...this.registered.keys()]
            .filter(k => k.startsWith(eventKey))
            .forEach(k => {
                this.registered.get(k)?.();
                this.registered.delete(k);
            });
        const { interactionType, context } = this.parseEventKey(eventKey);
        if (interactionType) {
            const interactionKey = this.getInteractionKey(interactionType, context);
            const interaction = this.interactions.get(interactionKey);
            if (interaction) {
                this.olMap.removeInteraction(interaction);
                this.interactions.delete(interactionKey);
            }
        }
    }

    clearInteractions(): void {
        this.interactions.forEach(interaction => {
            this.olMap.removeInteraction(interaction);
        });
        this.interactions.clear();
        this.registered.clear();
    }

    getInteraction<T extends Interaction>(interactionType: string, context = 'default'): T | null {
        const key = this.getInteractionKey(interactionType, context);
        return (this.interactions.get(key) as T) || null;
    }

    private parseEventKey(eventKey: string): { interactionType: InteractionType | null; context: string; phase?: string } {
        const parts = eventKey.split(':');
        if (parts.length < 2) return { interactionType: null, context: 'default' };
        const [interactionType, context, phase] = parts;
        return { interactionType: interactionType as InteractionType, context, phase };
    }

    private getInteractionKey(interactionType: string, context: string): string {
        return `${interactionType}:${context}`; // phase 제외
    }

    private translateMapEvent(eventKey: string): string {
        switch (eventKey) {
            case 'click':
                return 'click';
            case 'singleclick':
                return 'singleclick';
            case 'move':
                return 'moveend';
            default:
                return eventKey;
        }
    }

    private translateInteraction(interactionType: string, phase?: string): string[] {
        switch (interactionType) {
            case 'draw':
                if (phase === 'start') return ['drawstart'];
                if (phase === 'end') return ['drawend'];
                return ['drawstart', 'drawend'];
            case 'modify':
                if (phase === 'start') return ['modifystart'];
                if (phase === 'end') return ['modifyend'];
                return ['modifystart', 'modifyend'];
            case 'select':
                return ['select'];
            case 'translate':
                if (phase === 'start') return ['translatestart'];
                if (phase === 'end') return ['translateend'];
                return ['translatestart', 'translateend'];
            case 'snap':
                return [];
            default:
                return [];
        }
    }

    private createInteraction(interactionType: string, options?: EventOptions): Interaction | undefined {
        switch (interactionType) {
            case 'draw':
                return new Draw({
                    type: options?.drawGeometryType
                });
            case 'modify':
                return new Modify({
                    features: options?.features
                });
            case 'select':
                return new Select({
                    layers: options?.olLayers
                });
            case 'translate':
                return new Translate({
                    features: options?.features
                });
            case 'snap':
                return new Snap({
                    features: options?.features
                });
            default:
                return;
        }
    }
}
