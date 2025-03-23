import * as Cesium from "cesium";

self.onmessage = function (e) {
    const { newVehicleData, cameraPositionWC } = e.data;

    const result = newVehicleData.map(vehicle => {
        const vehiclePosition = Cesium.Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, vehicle.height);
        const distance = Cesium.Cartesian3.distance(cameraPositionWC, vehiclePosition);

        // 거리 계산에 따른 표시 유형 결정
        const displayType = distance < 1000 ? 'model' : 'point';
        const lod = distance > 1000 ? 0.01 : distance > 500 ? 0.05 : 1;

        // displayType이 변경된 경우에만 새로 계산된 결과를 반환
        if (displayType !== vehicle.displayType) {
            return {
                id: vehicle.id,
                distance: distance,
                lon: vehicle.lon,
                lat: vehicle.lat,
                height: vehicle.height,
                displayType: displayType,  // model/point
                lod: `lod_${lod}`,
                changed: true
            };
        }

        // displayType이 변경되지 않았다면 변경하지 않음
        return {
            ...vehicle,
            changed: false
        };
    });

    self.postMessage(result); // 계산된 거리와 표시 방법을 메인 스레드로 반환
};
