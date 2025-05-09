self.onmessage = function (e) {
    const { newVehicleData, cameraPositionWC } = e.data;

    const result = [];
    for (let i = 0; i < newVehicleData.length; i++) {
        const vehicle = newVehicleData[i];

        // 거리 계산: 유클리드 거리 (x, y, z 값 사용)
        const distance = calculateDistance(cameraPositionWC, vehicle.position);
        console.log(distance)

        const display = distance < 1000;

        if (display !== vehicle.display) {
            result.push({
                id: vehicle.id,
                distance: distance,
                display: display,
                changed: true
            });
        } else {
            vehicle.changed = false;
            result.push(vehicle);
        }
    }

    // 결과 반환
    self.postMessage(result);
};

// 유클리드 거리 계산 (x, y, z 값 기반)
function calculateDistance(cameraPosition, vehiclePosition) {
    const dx = vehiclePosition.x - cameraPosition.x;
    const dy = vehiclePosition.y - cameraPosition.y;
    const dz = vehiclePosition.z - cameraPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}