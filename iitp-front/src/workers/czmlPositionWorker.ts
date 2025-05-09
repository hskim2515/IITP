let entities = [];
let running = false;

self.onmessage = function (e) {
    const { type, payload } = e.data;

    if (type === "init") {
        entities = payload.entities;
        running = true;
        runLoop();
    }

    if (type === "stop") {
        running = false;
    }
};

function runLoop() {
    if (!running) return;

    const now = Date.now();
    const julianNow = Cesium.JulianDate.fromDate(new Date(now));

    const positions = [];

    for (const entity of entities) {
        const posProp = entity.position;
        if (posProp && posProp.getValue) {
            const cartesian = posProp.getValue(julianNow);
            if (cartesian) {
                positions.push({
                    id: entity.id,
                    position: cartesian
                });
            }
        }
    }

    self.postMessage({ type: "positions", payload: positions });

    setTimeout(runLoop, 1000);
}