import {Cartesian3} from "cesium";
import {computeODMatrix, parseRawODInputFromFlatArray} from "@utils/transform";

let czmlData = null;
let sampledPositionsList = []; // 각 객체별 sampled positions
let referenceTime = null;
let elapsed = 0;
let lastElapsed = 0;

self.onmessage = function (e) {
    const data = e.data;

    if (data.type === 'init') {
        czmlData = data.czmlPackets; // [[t, x, y, z, ...], [t, x, y, z, ...], ...]
        referenceTime = data.currentTime;

        sampledPositionsList = czmlData.map(track => extractSampledPositionsFromFlatArray(track));

        if (!sampledPositionsList || sampledPositionsList.length === 0) return;

        const time = data.currentTime;
        elapsed = lastElapsed + (time - referenceTime) / 1000; // 초

        const result = sampledPositionsList.map(sampled => interpolatePosition(sampled, elapsed));

        self.postMessage({ positions: result });
    }

    else if (data.type === 'tick') {

        if (!sampledPositionsList || sampledPositionsList.length === 0) return;

        const time = data.currentTime;
        elapsed = lastElapsed + (time - referenceTime) / 1000; // 초

        const result = sampledPositionsList.map(sampled => interpolatePosition(sampled, elapsed));

        self.postMessage({ positions: result });

    }else if (data.type === 'pause') {
        lastElapsed = elapsed;
        referenceTime = data.currentTime;
    }
};

function extractSampledPositionsFromFlatArray(flatArray) {
    const step = 4;
    const result = [];

    for (let i = 0; i < flatArray.length - step; i += step) {
        const startTime = flatArray[i];
        const startPos = [flatArray[i + 1], flatArray[i + 2], flatArray[i + 3]];

        const endTime = flatArray[i + step];
        const endPos = [flatArray[i + step + 1], flatArray[i + step + 2], flatArray[i + step + 3]];

        result.push({ startTime, endTime, startPos, endPos });
    }

    return result;
}

function interpolatePosition(sampled, t) {
    // t 초 단위 (기준 시간부터 경과한 시간)
    for (let i = 0; i < sampled.length; i++) {
        const { startTime, endTime, startPos, endPos } = sampled[i];
        if (t >= startTime && t <= endTime) {
            const duration = endTime - startTime;
            const localT = (t - startTime) / duration;

            return [
                startPos[0] + (endPos[0] - startPos[0]) * localT,
                startPos[1] + (endPos[1] - startPos[1]) * localT,
                startPos[2] + (endPos[2] - startPos[2]) * localT
            ];
        }
    }

}
