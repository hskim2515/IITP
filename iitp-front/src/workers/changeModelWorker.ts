import * as Cesium from "cesium";

self.onmessage = function (e) {
    const { newVehicleData, cameraPositionWC } = e.data;

    const result = [];
    for (let i = 0; i < newVehicleData.length; i++) {
        const vehicle = newVehicleData[i];
        const distance = Cesium.Cartesian3.distance(cameraPositionWC, vehicle.position);

        const display = distance < 500;

        if (display !== vehicle.display) {
            result.push({
                id: vehicle.id,
                distance: distance,
                display: display,
                changed: true
            });
        } else {
            vehicle.changed = false;
            result.push(vehicle)
        }
    }

    self.postMessage(result);
};
