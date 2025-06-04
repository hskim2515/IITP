import { useEffect, useRef } from "react";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useShallow } from "zustand/react/shallow";
import {useCesiumStore} from "@stores/useCesiumStore";
import {usePropertyStore} from "@stores/usePropertyStore";
import * as Cesium from "cesium";

const useSelect = () => {

    const viewer = useCesiumStore((state) => state.viewer);

    const selectedProps = usePropertyStore((state) => state.selectedProps);
    const setSelectedProps = usePropertyStore((state) => state.setSelectedProps);

    const infoEntityRef = useRef(null);

    const createCustomLabelTable = (data, lineHeight, font, options = {}) => {
        const {
            backgroundColor = 'rgba(220, 234, 248, 1.0)', // 배경 색상
            titleBackgroundColor = 'rgba(4, 167, 204, 1.0)', // 타이틀 배경 색상
            textColor = '#2D2D2D',                 // 텍스트 색상
            titleColor = '#FFFFFF',                // 타이틀 텍스트 색상
            padding = 20,                          // 내부 여백
            margin = 10,                           // 외부 여백
            borderRadius = 12,                     // 둥근 모서리
            borderColor = 'rgba(255, 255, 255, 0.3)', // 테두리 색상
            borderWidth = 1.5,                     // 테두리 두께
            titleHeight = 50,                      // 타이틀 높이
            titleFont = 'bold 22px Roboto, sans-serif', // 타이틀 폰트
            rowFont = '18px Roboto, sans-serif',   // 데이터 폰트
            keyColumnWidth = 0.5                   // 키 열 너비 비율 (전체의 40%)
        } = options;

        // 캔버스 크기 계산
        const canvasWidth = 350; // 고정 너비
        const numRows = Object.keys(data).length;
        const textHeight = numRows * lineHeight;
        const canvasHeight = textHeight + titleHeight + 2 * padding;

        // 캔버스 생성
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = canvasWidth + 2 * margin;
        canvas.height = canvasHeight + 2 * margin;

        // 배경 그리기 (둥근 모서리 포함)
        context.fillStyle = backgroundColor;
        context.beginPath();
        context.moveTo(margin + borderRadius, margin + titleHeight);
        context.lineTo(canvasWidth - borderRadius + margin, margin + titleHeight);
        context.arcTo(canvasWidth + margin, margin + titleHeight, canvasWidth + margin, borderRadius + margin + titleHeight, borderRadius);
        context.lineTo(canvasWidth + margin, canvasHeight - borderRadius + margin);
        context.arcTo(canvasWidth + margin, canvasHeight + margin, canvasWidth - borderRadius + margin, canvasHeight + margin, borderRadius);
        context.lineTo(borderRadius + margin, canvasHeight + margin);
        context.arcTo(margin, canvasHeight + margin, margin, canvasHeight - borderRadius + margin, borderRadius);
        context.lineTo(margin, borderRadius + margin + titleHeight);
        context.arcTo(margin, margin + titleHeight, borderRadius + margin, margin + titleHeight, borderRadius);
        context.closePath();
        context.fill();

        // 테두리 그리기
        if (borderWidth > 0) {
            context.strokeStyle = borderColor;
            context.lineWidth = borderWidth;
            context.stroke();
        }

        // 타이틀 영역 배경
        context.fillStyle = titleBackgroundColor;
        context.fillRect(margin, margin, canvasWidth, titleHeight);

        // 타이틀 텍스트
        context.font = titleFont;
        context.fillStyle = titleColor;
        context.textBaseline = 'middle';
        context.fillText('속성정보', margin + padding, margin + titleHeight / 2);

        // 텍스트 스타일 설정
        context.font = rowFont;
        context.fillStyle = textColor;
        context.textBaseline = 'top';

        // Key와 Value를 그릴 때 테이블처럼 보이게 하기 위해 선을 추가합니다.
        const keyColumnX = margin + padding;
        const valueColumnX = keyColumnX + canvasWidth * keyColumnWidth;

        // 그리드 선 (테이블 형식의 선)
        context.beginPath();
        //context.moveTo(margin + keyColumnWidth * canvasWidth, margin + titleHeight); // 수평선 시작 (타이틀 아래)
        context.lineTo(margin + keyColumnWidth * canvasWidth, canvasHeight + margin); // 수직선 끝
        context.moveTo(margin + keyColumnWidth * canvasWidth + 5, margin + titleHeight); // 수평선
        context.lineTo(canvasWidth + margin + 5, margin + titleHeight); // 오른쪽 끝
        context.strokeStyle = textColor;
        context.stroke();

        // 데이터 그리기 (key-value 형태)
        Object.entries(data).forEach(([key, value], index) => {
            const rowY = margin + titleHeight + padding + index * lineHeight;

            // Key 텍스트
            context.fillText(key, keyColumnX, rowY);

            // Value 텍스트
            context.fillText(value, valueColumnX, rowY);

            // 데이터 구분 선 (수평선)
            context.beginPath();
            context.moveTo(keyColumnX, rowY + lineHeight);
            context.lineTo(canvasWidth + margin, rowY + lineHeight);
            context.stroke();
        });

        return canvas.toDataURL(); // 이미지 데이터 반환
    }

    useEffect(() => {
        const fontSize = 20

        if(selectedProps) {

            if(infoEntityRef.current){
                viewer?.entities.remove(infoEntityRef.current)
            }

            const positions = generateWallFacingCamera(selectedProps.longitude, selectedProps.latitude, 30)

            infoEntityRef.current = viewer.entities.add({
                wall: {
                    name: 'info-wall',
                    positions: positions,
                    minimumHeights: positions.map(() => 5),
                    maximumHeights: positions.map(() => 30), // 벽 높이(m)
                    outline: true,
                    outlineColor: Cesium.Color.LIGHTGRAY,
                    outlineWidth: 4,
                    material: new Cesium.ImageMaterialProperty({
                        image: createCustomLabelTable(selectedProps, fontSize, `${fontSize}px Roboto, sans-serif`),
                        repeat: new Cesium.Cartesian2(1.0, 1.0),
                        transparent: true,
                    }),
                },
            });
        }

    }, [selectedProps]);

    // const generateRectangleWallPositions = (centerLon, centerLat, widthMeters, heightMeters) => {
    //     const ellipsoid = Cesium.Ellipsoid.WGS84;
    //
    //     const center = Cesium.Cartographic.fromDegrees(centerLon, centerLat);
    //     const centerCartesian = ellipsoid.cartographicToCartesian(center);
    //
    //     const localTransform = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
    //
    //     const halfWidth = widthMeters / 2;
    //     const halfHeight = heightMeters / 2;
    //
    //     const cornersLocal = [
    //         new Cesium.Cartesian3(-halfWidth, -halfHeight, 0),
    //         new Cesium.Cartesian3(-halfWidth, halfHeight, 0),
    //         new Cesium.Cartesian3(halfWidth, halfHeight, 0),
    //         new Cesium.Cartesian3(halfWidth, -halfHeight, 0),
    //         new Cesium.Cartesian3(-halfWidth, -halfHeight, 0), // 닫기
    //     ];
    //
    //     const cornersGlobal = cornersLocal.map((local) => {
    //         const global = Cesium.Matrix4.multiplyByPoint(localTransform, local, new Cesium.Cartesian3());
    //         const carto = ellipsoid.cartesianToCartographic(global);
    //         return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude);
    //     });
    //
    //     return cornersGlobal;
    // }

    function generateWallFacingCamera(centerLon, centerLat, widthMeters) {
        const ellipsoid = Cesium.Ellipsoid.WGS84;

        // 중심 Cartographic & Cartesian
        const centerCartographic = Cesium.Cartographic.fromDegrees(centerLon, centerLat);
        const centerCartesian = ellipsoid.cartographicToCartesian(centerCartographic);

        // ENU 좌표계 생성
        const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);

        // 카메라 방향을 기준점에서의 로컬 벡터로 변환
        const cameraDirWorld = Cesium.Cartesian3.clone(viewer.camera.directionWC);
        const cameraDirLocal = Cesium.Matrix4.inverseTransformation(enuMatrix, new Cesium.Matrix4());
        const cameraDirInENU = Cesium.Matrix4.multiplyByPointAsVector(
            cameraDirLocal,
            cameraDirWorld,
            new Cesium.Cartesian3()
        );

        // Z (Up) 성분 제거 → 지면 방향으로 정렬
        cameraDirInENU.z = 0;
        Cesium.Cartesian3.normalize(cameraDirInENU, cameraDirInENU);

        // 좌우 방향은 이 벡터에 수직한 벡터: (x, y) → (-y, x)
        const perpendicularENU = new Cesium.Cartesian3(-cameraDirInENU.y, cameraDirInENU.x, 0);
        Cesium.Cartesian3.normalize(perpendicularENU, perpendicularENU);

        // 다시 월드 좌표계로 변환
        const offsetWorld = Cesium.Matrix4.multiplyByPointAsVector(
            enuMatrix,
            Cesium.Cartesian3.multiplyByScalar(perpendicularENU, widthMeters / 2, new Cesium.Cartesian3()),
            new Cesium.Cartesian3()
        );

        const point1 = Cesium.Cartesian3.add(centerCartesian, offsetWorld, new Cesium.Cartesian3());
        const point2 = Cesium.Cartesian3.subtract(centerCartesian, offsetWorld, new Cesium.Cartesian3());

        return [point1, point2];
    }



};

export default useSelect;
