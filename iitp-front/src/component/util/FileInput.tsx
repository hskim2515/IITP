import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

interface FileInputProps {
    value: string | File | null;
    onChange: (value: File | null) => void;
    readOnly?: boolean;
}

const FileInput: React.FC<FileInputProps> = ({ value, onChange, readOnly = false }) => {
    const [preview, setPreview] = useState<string | null>(null);
    const baseUrl = process.env.REACT_APP_FILE_BASE_URL || '';

    const loadGLBThumbnail = async (arrayBuffer: ArrayBuffer) => {
        const loader = new GLTFLoader();
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(256, 256);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        scene.add(light);

        loader.parse(arrayBuffer, '', (gltf) => {
            const model = gltf.scene;
            scene.add(model);

            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            model.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            const cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.5;

            camera.position.set(cameraZ, cameraZ, cameraZ);
            camera.lookAt(0, 0, 0);

            light.position.set(cameraZ, cameraZ, cameraZ);

            renderer.render(scene, camera);
            const canvas = renderer.domElement;

            try {
                const imgDataUrl = canvas.toDataURL();
                setPreview(imgDataUrl);
            } catch (err) {
                console.error("Canvas toDataURL error:", err);
            }
        }, (error) => {
            console.error("GLTF parsing error:", error);
        });
    };

    useEffect(() => {
        if (!value) {
            setPreview(null);
            return;
        }

        if (value instanceof File && value.name.endsWith('.glb')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const arrayBuffer = e.target?.result;
                if (arrayBuffer && typeof arrayBuffer !== "string") {
                    loadGLBThumbnail(arrayBuffer);
                }
            };
            reader.readAsArrayBuffer(value);
        }

        if (typeof value === "string" && value.endsWith('.glb')) {
            const fullUrl = baseUrl + value;
            fetch(fullUrl)
                .then(res => res.arrayBuffer())
                .then(buffer => loadGLBThumbnail(buffer))
                .catch(err => console.error("GLB fetch error:", err));
        }

    }, [value]);

    const fileName = value instanceof File
        ? value.name
        : (typeof value === 'string' ? value.split('/').pop() : '');

    return (
        <div>
            {preview && (
                <div>
                    <img
                        src={preview}
                        width={200}
                        height={200}
                        style={{ verticalAlign: "middle", marginRight: 8, border: "1px solid #ccc", borderRadius: 8 }}
                        alt="GLB Thumbnail"
                    />
                </div>
            )}
            {typeof value === 'string' && (
                <div style={{ marginTop: 8 }}>
                    <a href={baseUrl + value} target="_blank" rel="noopener noreferrer">
                        {fileName}
                    </a>
                </div>
            )}
            {!readOnly && (
                <input
                    type="file"
                    accept=".glb"
                    onChange={(e) => onChange(e.target.files?.[0] || null)}
                    style={{ marginTop: 8 }}
                />
            )}
        </div>
    );
};

export default FileInput;
