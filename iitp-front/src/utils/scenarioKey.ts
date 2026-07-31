const pad = (value: number, length: number) => String(value).padStart(length, "0");

const randomSuffix = () => {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0]!.toString(36).toUpperCase().padStart(7, "0").slice(-7);
};

/**
 * 사용자가 식별할 수 있는 생성 시각과 충돌 방지용 난수를 함께 사용한다.
 * 예: SCENARIO_20260730_142305_127_04F8K2A
 */
export const generateScenarioKey = (now = new Date()) => {
    const date = [
        now.getFullYear(),
        pad(now.getMonth() + 1, 2),
        pad(now.getDate(), 2),
    ].join("");
    const time = [
        pad(now.getHours(), 2),
        pad(now.getMinutes(), 2),
        pad(now.getSeconds(), 2),
    ].join("");

    return `SCENARIO_${date}_${time}_${pad(now.getMilliseconds(), 3)}_${randomSuffix()}`;
};
