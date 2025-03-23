import { NodeIO } from '@gltf-transform/core';
import {
    simplify, draco, weld, quantize, partition, unpartition,
    dequantize, unweld, cloneDocument
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

self.onmessage = async (event) => {
    const { glbBuffer, lodLevels } = event.data;

    try {
        const io = new NodeIO();
        const document = await io.readBinary(new Uint8Array(glbBuffer)); // GLB 읽기

        const lodBuffers = {};

        // 각 LOD 레벨에 대해 최적화 작업 수행
        for (const level of lodLevels) {
            const docCopy = await cloneDocument(document); // 문서 복사
            const root = docCopy.getRoot();
            const meshes = root.listMeshes();

            console.log(`Processing ${meshes.length} meshes for LOD ${level}...`);

            // 중복 정점 병합 (모든 Mesh에 적용)
            await docCopy.transform(weld({ tolerance: 0.0001 }));

            // 대형 메시 분할 후 병합
            await docCopy.transform(partition({ threshold: 10000 }));
            await docCopy.transform(unpartition());

            // Draco 압축 및 정점 복구
            await docCopy.transform(draco({ method: 'EDGEBREAKER', encodeSpeed: 5 }));
            await docCopy.transform(quantize({ bits: 8 }));

            // 추가적인 단순화 적용 (MeshoptSimplifier 사용)
            await docCopy.transform(simplify({
                ratio: level, // LOD 레벨에 따라 비율 조정
                simplifier: MeshoptSimplifier,
                preserveTopology: false
            }));

            // dequantize & unweld (정점 복구)
            await docCopy.transform(dequantize());
            await docCopy.transform(unweld());

            // 최적화된 GLB로 변환 후 버퍼에 저장
            lodBuffers[`lod_${level}`] = new Uint8Array(await io.writeBinary(docCopy));
        }

        // 최적화된 모든 LOD 버퍼 반환
        self.postMessage({ success: true, lodBuffers });
    } catch (error) {
        // 에러 발생 시 메세지와 스택 추적 반환
        self.postMessage({ success: false, error: error.message, stack: error.stack });
    }
};
