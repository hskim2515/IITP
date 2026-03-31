import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { buildFileUrl } from "@utils/fileUrl";

interface Props {
    value: string;
}

const FileCellRenderer: React.FC<Props> = ({ value }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    useEffect(() => {
        const filePath = buildFileUrl(value);
        if (!filePath.endsWith(".glb")) return;

        const loader = new GLTFLoader();
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(128, 128);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        scene.add(light);

        loader.load(
            filePath,
            (gltf) => {
                const model = gltf.scene;
                scene.add(model);

                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                model.position.sub(center);

                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = camera.fov * (Math.PI / 180);
                const cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 0.8;

                camera.position.set(cameraZ, cameraZ, cameraZ);
                camera.lookAt(0, 0, 0);
                light.position.set(cameraZ, cameraZ, cameraZ);

                renderer.render(scene, camera);

                const canvas = renderer.domElement;
                try {
                    const imgDataUrl = canvas.toDataURL();
                    setImageUrl(imgDataUrl);
                } catch (e) {
                    console.error("toDataURL failed:", e);
                }
            },
            undefined,
            (error) => {
                console.error("GLB load error:", error);
            }
        );
    }, [value]);

    return (
        <div style={{display: "flex", alignItems: "center", gap: 6}}>
            {imageUrl && (
                <img
                    src={imageUrl}
                    width={30}
                    height={30}
                    alt="GLB Preview"
                    style={{verticalAlign: "middle", marginTop: 5, border: "1px solid #ccc", borderRadius: 4}}
                />
            )}
            <span>{typeof value === 'string' ? value.split('/').pop() ?? '' : ''}</span>
        </div>
    );
};

export default FileCellRenderer;
