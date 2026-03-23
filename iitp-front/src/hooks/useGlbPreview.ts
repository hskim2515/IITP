import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { useCesiumStore } from '@stores/useCesiumStore';

interface HprRad {
    heading: number;
    pitch: number;
    roll: number;
}

/**
 * Cesium map에 GLB 모델을 프리뷰 엔티티로 표시합니다.
 * - glbUrl이 null이면 엔티티를 제거합니다.
 * - hpr 변경 시 엔티티 방향만 업데이트합니다.
 * - 컴포넌트 언마운트 시 자동 제거됩니다.
 */
export function useGlbPreview(glbUrl: string | null, hpr: HprRad) {
    const viewer = useCesiumStore.getState().viewer;
    const entityRef = useRef<Cesium.Entity | null>(null);
    const posRef = useRef<Cesium.Cartesian3 | null>(null);

    // GLB URL 변경 시: 엔티티 생성/제거
    useEffect(() => {
        if (!viewer) return;

        if (entityRef.current) {
            viewer.entities.remove(entityRef.current);
            entityRef.current = null;
        }

        if (!glbUrl) return;

        // 카메라 중심점 지표면 근처에 배치
        const camPos = viewer.camera.positionCartographic;
        const position = Cesium.Cartesian3.fromRadians(
            camPos.longitude,
            camPos.latitude,
            5, // 지상 5m
        );
        posRef.current = position;

        const orientation = Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(hpr.heading, hpr.pitch, hpr.roll)
        );

        entityRef.current = viewer.entities.add({
            position,
            orientation: new Cesium.ConstantProperty(orientation),
            model: {
                uri: glbUrl,
                scale: 3.0,
                minimumPixelSize: 48,
                maximumScale: 200,
                shadows: Cesium.ShadowMode.DISABLED,
            },
        });

        // 엔티티 쪽으로 카메라 이동
        viewer.flyTo(entityRef.current, {
            offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(0),
                Cesium.Math.toRadians(-30),
                30,
            ),
            duration: 1.2,
        });

        return () => {
            if (entityRef.current) {
                viewer.entities.remove(entityRef.current);
                entityRef.current = null;
            }
        };
    }, [viewer, glbUrl]);

    // heading/pitch/roll 변경 시: 방향만 업데이트 (엔티티 재생성 없이)
    useEffect(() => {
        if (!entityRef.current || !posRef.current) return;
        const q = Cesium.Transforms.headingPitchRollQuaternion(
            posRef.current,
            new Cesium.HeadingPitchRoll(hpr.heading, hpr.pitch, hpr.roll)
        );
        (entityRef.current.orientation as Cesium.ConstantProperty).setValue(q);
    }, [hpr.heading, hpr.pitch, hpr.roll]);
}
