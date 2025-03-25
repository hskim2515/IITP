import * as Cesium from "cesium";
import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";

import { Deck } from "@deck.gl/core";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";

class HeatMapLayer {
    constructor(
        viewer,
        positions,

    ) {
        this.viewer = viewer;
        this.positions = positions;
        this.currentIndex = 0;
        this.progress = 0;
        this.heatmapLayer = null; // DeckGL 히트맵 레이어 저장
        this.deck = null; // DeckGL 인스턴스 저장
        this.init();
    }

    init() {
        const gl = this.viewer.canvas.getContext("webgl2");

        // DeckGL 히트맵 레이어 생성
        this.heatmapLayer = new HeatmapLayer({
            id: "heatmap-layer",
            data: [],
            getPosition: (d) => d.position,
            getWeight: (d) => d.weight,
            radiusPixels: 50
        });

        // DeckGL 인스턴스 생성
        this.deck = new Deck({
            gl,
            layers: [this.heatmapLayer]
        });
    }

    cartesian3ToGeoData(cartesianArray, weightValue = 1) {
        return cartesianArray.map(cartesian => {
            // Cartesian3을 Cartographic으로 변환
            const cartographic = Cartographic.fromCartesian(cartesian);

            // 경도(longitude)와 위도(latitude)를 도(degrees)로 변환
            const lon = CesiumMath.toDegrees(cartographic.longitude);
            const lat = CesiumMath.toDegrees(cartographic.latitude);

            // 변환된 위치를 포함하는 객체 생성
            return {
                position: [lon, lat],
                weight: weightValue // 기본적으로 weight 값은 1로 설정하거나 다른 값 사용
            };
        });
    }

    update(frameState) {
        if (!this.positions || this.positions.length < 2) {
            console.error("🚨 경로 데이터가 부족합니다.");
            return;
        }

        if (this.progress >= 1) {
            this.progress = 0;
            this.currentIndex++;

            if (this.currentIndex >= this.positions.length - 1) {
                this.currentIndex = 0;
            }
        } else {
            let startPositionArray = this.positions[this.currentIndex];
            let endPositionArray = this.positions[this.currentIndex + 1];

            if (!startPositionArray || !endPositionArray) return;

            this.progress += 0.01;
            if (this.progress > 1) this.progress = 1;

            // 보간하여 새로운 위치 생성
            let interpolatedPositions = startPositionArray.map((startPosition, i) => {
                let endPosition = endPositionArray[i];
                if (!endPosition) return startPosition;

                let interpolated = new Cesium.Cartesian3();
                Cesium.Cartesian3.lerp(startPosition, endPosition, this.progress, interpolated);
                return interpolated;
            });

            // 데이터 변환

            if (this.deck) {
                this.heatmapLayer = new HeatmapLayer({
                    id: "heatmap-layer",
                    data : this.cartesian3ToGeoData(interpolatedPositions),
                    getPosition: (d) => d.position,
                    getWeight: (d) => d.weight,
                    radiusPixels: 50
                });

                this.deck.setProps({ layers: [this.heatmapLayer] });
            }
        }
    }

    destroy() {
        if (this.deck) {
            this.deck.finalize();
            this.deck = null;
        }
        this.viewer = null;
    }
}

export default HeatMapLayer;
