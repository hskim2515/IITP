// 차량 위치 데이터를 처리하여 Canvas 좌표로 변환
import * as Cesium from "cesium";

self.onmessage = function (event) {
    const { vehicleData, width, height, bounds, currentTime } = event.data;

    // 차량 위치 계산 및 Canvas에 점 그리기
    const vehiclePositions = vehicleData.map(vehicle => {
        const position = vehicle.position;
        if (position) {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            return {
                x: Cesium.Math.toDegrees(cartographic.longitude),
                y: Cesium.Math.toDegrees(cartographic.latitude)
            };
        }
        return null;
    }).filter(pos => pos !== null);

    // OffscreenCanvas 생성 및 히트맵 생성
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);

    vehiclePositions.forEach(({ x, y }) => {
        const [px, py] = latLonToCanvas(x, y, width, height, bounds);
        const vehicleCountAtPosition = vehiclePositions.filter(pos => pos.x === x && pos.y === y).length;

        // 밀도에 따라 원의 크기나 색을 조정
        const radius = Math.min(10 + vehicleCountAtPosition, 30); // 원의 크기
        const opacity = Math.min(vehicleCountAtPosition * 0.1, 0.8); // 투명도

        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`; // 빨간색으로 표시 (밀도가 높은 곳일수록 빨간색)
        ctx.fill();
    });

    // Blob으로 변환 후 메인 스레드로 전달
    canvas.convertToBlob({ type: "image/png" }).then(blob => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            self.postMessage({ heatmapDataUrl: reader.result });
        };
    });
};

// WGS84 좌표를 Canvas 좌표로 변환
function latLonToCanvas(lon, lat, width, height, bounds) {
    const { minX, maxX, minY, maxY } = bounds;
    const x = ((lon - minX) / (maxX - minX)) * width;
    const y = height - ((lat - minY) / (maxY - minY)) * height;
    return [x, y];
}
