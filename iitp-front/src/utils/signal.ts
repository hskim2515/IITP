import * as Cesium from "cesium";
import { Style } from "ol/style";
import {getFeaturesByProperties} from "@utils/feature";
import {SignalTimelineResponse} from "@stores/useSignalTimelineStore";
import {LayerManager} from "@deck.gl/core";
import {Feature} from "ol";

export type SignalState = "green" | "yellow" | "red" | "default";

export const updateSignalStyles = (layerManager:LayerManager, viewer:Cesium.Viewer, connectionFeatureMapRef:Map<string, Feature>, signalTimeline:SignalTimelineResponse, currentSimTime: number) => {
    const signalConnectionSet = new Set<string>();
    if (connectionFeatureMapRef.size === 0) {
        const networkLayer = layerManager.getLayer("facility", "network")?.[0];
        if (!networkLayer) return;

        const styleFunction = networkLayer.getStyleFunction();

        const features = getFeaturesByProperties(networkLayer, { featureType: networkLayer.getConnectionFeatureType() });
        features.forEach(f => {
            const nodeId = f.get("nodeId");
            const connId = f.get("id");
            const key = `${nodeId}_${connId}`;
            connectionFeatureMapRef.set(key, f);
            if (!f.get('__originalStyle')) {
                const originalStyle = styleFunction(f, 1);
                f.set('__originalStyle', Array.isArray(originalStyle) ? originalStyle : [originalStyle]);

            }
        });
    }
    signalTimeline.forEach(sig => {
        sig.turnInfo.forEach(turn => {
            turn.connList.forEach(connIdStr => {
                const key = `${sig.nodeId}_${connIdStr}`;
                signalConnectionSet.add(key);
            });
        });
    });

    const activeConnectionsMap = new Map<string, { nodeId: string, connId: number, signalState: string }>();
    signalTimeline.forEach(sig => {
        sig.signalTimeline.forEach(timeline => {
            const start = new Date(timeline.startTime).getTime();
            const end = new Date(timeline.endTime).getTime();

            if (currentSimTime >= start && currentSimTime < end) {
                timeline.activeTurns.forEach(turnId => {
                    const turn = sig.turnInfo.find(t => t.id == turnId);
                    if (turn?.connList) {
                        turn.connList.forEach(connIdStr => {
                            const key = `${sig.nodeId}_${connIdStr}`;
                            if (!activeConnectionsMap.has(key)) {
                                activeConnectionsMap.set(key, { nodeId: sig.nodeId, connId: Number(connIdStr), signalState: timeline.signalState });
                            }
                        });
                    }
                });
            }
        });
    });

    connectionFeatureMapRef.forEach((feature, key) => {
        if (signalConnectionSet.has(key)) {
            const activeConn = activeConnectionsMap.get(key);
            if (activeConn) {
                applyOlSignalStyle(feature, activeConn.signalState);
                applyCesiumSignalStyle(viewer, feature.get('__guid'), activeConn.signalState);
            } else {
                applyOlSignalStyle(feature, "red");
                applyCesiumSignalStyle(viewer, feature.get('__guid'), "red");
            }
        } else {
        }
    });
};

export const getSignalColor = (state: SignalState) => {
    switch (state) {
        case "green": return { css: "rgba(0,255,0)", cesium: Cesium.Color.GREEN.withAlpha(0.7) };
        case "yellow": return { css: "rgba(255,255,0)", cesium: Cesium.Color.YELLOW.withAlpha(0.7) };
        case "red": return { css: "rgba(255,0,0)", cesium: Cesium.Color.RED.withAlpha(0.7) };
        default: return { css: "rgba(255,255,255)", cesium: Cesium.Color.WHITE.withAlpha(0.7) };
    }
};

// OpenLayers 스타일 적용
export const applyOlSignalStyle = (feature: any, state: SignalState) => {
    const originalStyles: Style[] = feature.get('__originalStyle');
    if (!originalStyles) return;

    const { css } = getSignalColor(state);

    const newStyles = originalStyles.map(style => {
        const newStyle = style.clone();
        newStyle.getStroke()?.setColor(css);
        newStyle.getFill()?.setColor(css);
        return newStyle;
    });

    feature.setStyle(newStyles);
};

// Cesium 스타일 적용
export const applyCesiumSignalStyle = (viewer: Cesium.Viewer, guid: string, state: SignalState) => {
    if (!guid) return;
    const dataSource = viewer.dataSources.get(0);
    if (!dataSource) return;

    const entity = dataSource.entities.getById(guid);
    if (!entity?.polyline) return;

    const { cesium } = getSignalColor(state);
    entity.polyline.material = new Cesium.PolylineArrowMaterialProperty(cesium);
    entity.polyline.clampToGround = true;
};

export const getNetworkGuid = (layerManager: LayerManager, signalGuid: string) => {
    if (!layerManager) return null;

    const networkLayer = layerManager.getLayer("facility", "network")?.[0];
    const signalLayer = layerManager.getLayer("facility", "signal");
    if (!networkLayer || !signalLayer) return null;

    const networkFeatures = networkLayer.getSource?.()?.getFeatures?.() || [];
    const signalFeatures = signalLayer.getSource?.()?.getFeatures?.() || [];

    const connectionFeatures = networkFeatures.filter(
        f => f.get('featureType') === 'connection-edit'
    );

    const targetFeature = signalFeatures.find(
        f => f.get("__guid") === signalGuid
    );
    if (!targetFeature) return null;

    const nodeId = targetFeature.get("nodeId");
    const connectionId = targetFeature.get("connectionId");

    const feature = connectionFeatures.find(
        f => f.get('nodeId') === nodeId && f.get('id') === connectionId
    );

    if (feature) {
        return feature.get('__guid');
    }

    return null;
}


export const getSignalGuid = (layerManager: LayerManager, connectionGuid: string): string | null => {
    if (!layerManager) return null;

    const networkLayer = layerManager.getLayer("facility", "network")?.[0];
    const signalLayer = layerManager.getLayer("facility", "signal");
    if (!networkLayer || !signalLayer) return null;
    const networkFeatures = networkLayer.getSource?.()?.getFeatures?.() || [];
    const signalFeatures = signalLayer.getSource?.()?.getFeatures?.() || [];

    const connectionFeatures = networkFeatures.filter(
        f => f.get('featureType') === 'connection-edit'
    );

    const connectionFeature = connectionFeatures.find(
        f => f.get("__guid") === connectionGuid
    );
    if (!connectionFeature) return null;

    const nodeId = connectionFeature.get("nodeId");
    const connectionId = connectionFeature.get("id");

    const signalFeature = signalFeatures.find(
        f => f.get("nodeId") === nodeId && f.get("connectionId") === connectionId
    );

    return signalFeature?.get("__guid") ?? null;
}
