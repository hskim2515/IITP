import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

interface Props {
    value: string;
}

const FileCellRenderer: React.FC<Props> = ({ value }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const baseUrl = process.env.REACT_APP_FILE_BASE_URL || '';

    useEffect(() => {
        const filePath = baseUrl+ value
        if (!filePath.endsWith(".glb")) return;

        const loader = new GLTFLoader();
        loader.setCrossOrigin("anonymous");
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
        camera.position.set(3, 2, 4);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(128, 128);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(5, 5, 5);
        scene.add(light);

        loader.load(filePath, (gltf) => {
            scene.add(gltf.scene);

            renderer.render(scene, camera);

            const canvas = renderer.domElement;
            if (!canvas) {
                console.warn("Renderer canvas is null!");
                return;
            }

            try {
                const imgDataUrl = canvas.toDataURL();
                setImageUrl(imgDataUrl);
            } catch (e) {
                console.error("toDataURL failed:", e);
            }
        });

    }, [value]);

    return (
        <>
            <img src={imageUrl} width={50} height={50} style={{verticalAlign: "middle", marginTop:5}}/>
            <span>{value.split('/').pop()}</span>
        </>
    )
};

export default FileCellRenderer;
