import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

interface HprRad {
    heading: number;
    pitch: number;
    roll: number;
}

interface Props {
    glbUrl: string | null;
    hprRad: HprRad;
    zOffset?: number;
}

const GlbMiniViewer: React.FC<Props> = ({ glbUrl, hprRad, zOffset = 0 }) => {
    const containerRef  = useRef<HTMLDivElement>(null);
    const rendererRef   = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef      = useRef<THREE.Scene | null>(null);
    const cameraRef     = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef   = useRef<InstanceType<typeof OrbitControls> | null>(null);
    const displayGroupRef = useRef<THREE.Group | null>(null); // ENU→Three.js 좌표계 변환 그룹
    const groupRef      = useRef<THREE.Group | null>(null);   // 모델 그룹 (HPR 회전 적용)
    const animRef       = useRef<number>(0);
    const modelScaleRef = useRef<number>(1);  // GLB 정규화 스케일 (1 Three.js unit = 1/scale 미터)

    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

    /* ── 씬 초기화 (마운트 1회) ────────────────────────────────── */
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const W = el.clientWidth || 420;
        const H = 240;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(W, H);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x0d0f1a);
        el.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Scene
        const scene = new THREE.Scene();
        sceneRef.current = scene;

        // 바닥 그리드 (ENU 지면 = Three.js XZ 평면)
        const grid = new THREE.GridHelper(20, 20, 0x334466, 0x1e2a3a);
        scene.add(grid);

        // ENU → Three.js 디스플레이 변환 그룹
        // Rx(-90°): ENU X(East)→X, ENU Y(North)→Three.js -Z(화면 안), ENU Z(Up)→Three.js Y(위)
        const displayGroup = new THREE.Group();
        displayGroup.rotation.x = -Math.PI / 2;
        scene.add(displayGroup);
        displayGroupRef.current = displayGroup;

        // ENU 축 표시 (X=빨강/East, Y=초록/North/전방, Z=파랑/Up)
        const axes = new THREE.AxesHelper(4);
        displayGroup.add(axes);

        // 조명
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(5, 10, 7);
        scene.add(dir);
        const dir2 = new THREE.DirectionalLight(0x8888ff, 0.4);
        dir2.position.set(-5, 3, -5);
        scene.add(dir2);

        // 카메라
        const camera = new THREE.PerspectiveCamera(45, W / H, 0.001, 10000);
        camera.position.set(5, 4, 7);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        // OrbitControls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.target.set(0, 0, 0);
        controlsRef.current = controls;

        // 모델 그룹 (correctionHpr 회전 적용, ENU 공간 기준)
        const group = new THREE.Group();
        displayGroup.add(group);
        groupRef.current = group;

        // 렌더 루프
        let active = true;
        const animate = () => {
            if (!active) return;
            animRef.current = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        return () => {
            active = false;
            cancelAnimationFrame(animRef.current);
            controls.dispose();
            renderer.dispose();
            if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
        };
    }, []);

    /* ── GLB URL 변경 → 모델 재로드 ───────────────────────────── */
    useEffect(() => {
        const group = groupRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!group || !camera || !controls) return;

        // 기존 모델 제거
        while (group.children.length > 0) {
            const child = group.children[0] as THREE.Mesh;
            group.remove(child);
            child.traverse?.((obj: THREE.Object3D) => {
                if ((obj as THREE.Mesh).isMesh) {
                    (obj as THREE.Mesh).geometry?.dispose();
                }
            });
        }

        if (!glbUrl) { setStatus('idle'); return; }

        setStatus('loading');
        const loader = new GLTFLoader();
        loader.load(
            glbUrl,
            (gltf) => {
                const model = gltf.scene;

                // 크기 정규화 (longest axis → 2 units)
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                const scale = 2.0 / maxDim;
                modelScaleRef.current = scale;

                model.scale.setScalar(scale);
                // 모델 중심을 ENU 원점에 배치 (correctionHpr 회전 후 중심이 원점)
                model.position.set(
                    -center.x * scale,
                    -center.y * scale,
                    -center.z * scale,
                );

                group.add(model);

                // zOffset 적용 (모델 로드 후 현재 zOffset 반영)
                group.position.z = zOffset * scale;

                // 카메라 거리 조정
                const dist = 2.0 * 2.5;
                camera.position.set(dist, dist * 0.8, dist);
                camera.lookAt(0, 0, 0);
                controls.target.set(0, 0, 0);
                controls.update();

                setStatus('idle');
            },
            undefined,
            (err) => {
                console.error('GLB load error:', err);
                setStatus('error');
            },
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [glbUrl]);

    /* ── Z-offset 변경 → 그룹 ENU Z(Up) 방향 이동 ────────────── */
    useEffect(() => {
        if (!groupRef.current) return;
        // displayGroup 로컬 공간에서 Z축 = ENU Up 방향
        // 실제 미터 → Three.js 단위: zOffset * modelScale
        groupRef.current.position.z = zOffset * modelScaleRef.current;
    }, [zOffset]);

    /* ── HPR 변경 → 그룹 회전만 업데이트 ─────────────────────── */
    useEffect(() => {
        if (!groupRef.current) return;
        // Cesium Matrix3.fromHeadingPitchRoll = Rz(-H)·Ry(-P)·Rx(R)
        // Three.js 'ZYX' rotation.set(x,y,z) 행렬 = Rz(z)·Ry(y)·Rx(x)
        //   → set(roll, -pitch, -heading, 'ZYX') = Rz(-H)·Ry(-P)·Rx(R) ✓
        groupRef.current.rotation.set(
            hprRad.roll,
            -hprRad.pitch,
            -hprRad.heading,
            'ZYX',
        );
    }, [hprRad.heading, hprRad.pitch, hprRad.roll]);

    return (
        <div style={{ position: 'relative', width: '100%', height: 240, flexShrink: 0 }}>
            <div
                ref={containerRef}
                style={{
                    width: '100%', height: 240,
                    borderRadius: 8, overflow: 'hidden',
                    background: 'rgb(var(--surface-1-rgb))',
                    border: '1px solid rgba(var(--overlay-rgb), 0.08)',
                }}
            />

            {/* 축 범례 — ENU 축 이름(X East/Y North/Z Up) 대신 이 도구의 실제 쓰임(방향 보정)
                기준으로 직관적인 한글 레이블 사용. heading=0일 때 모델이 North를 향한다는
                Cesium 관례상 Y(North)=정면, 그 기준 오른쪽이 X(East), 위가 Z(Up). */}
            <div style={{
                position: 'absolute', top: 6, left: 8,
                fontSize: 10, lineHeight: 1.6,
                pointerEvents: 'none', userSelect: 'none',
            }}>
                <span style={{ color: '#55ff55' }}>■ 정면</span>
                {'  '}
                <span style={{ color: '#ff5555' }}>■ 오른쪽</span>
                {'  '}
                <span style={{ color: '#5599ff' }}>■ 위</span>
            </div>

            {/* 로딩/에러 오버레이 */}
            {status === 'loading' && (
                <div style={{
                    position: 'absolute', inset: 0, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(var(--surface-1-rgb), 0.65)', fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.4)',
                    pointerEvents: 'none',
                }}>
                    모델 로딩 중...
                </div>
            )}
            {status === 'error' && (
                <div style={{
                    position: 'absolute', inset: 0, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(var(--surface-1-rgb), 0.65)', fontSize: 12, color: 'var(--color-danger)',
                    pointerEvents: 'none',
                }}>
                    GLB 로딩 실패 (파일 형식 또는 경로 확인)
                </div>
            )}
        </div>
    );
};

export default GlbMiniViewer;
