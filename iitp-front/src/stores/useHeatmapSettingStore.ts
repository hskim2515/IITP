import { create } from 'zustand';
import { createSelectors } from "@stores/createSelectors";
import { combine, devtools } from "zustand/middleware";

interface State {
    colors: string[];
    exaggeration: number; // cesium, 0.1 ~ 2.0
    blur: number; // openlayers, 50 ~ 1, radius 도 함께 적용(임시)
}

interface Actions {
    setColors: (colors: string[]) => void;
    setExaggeration: (value: number) => void;
    setBlur: (value: number) => void;
}

const initialState = {
    colors: [ "#0000FF", "#00FF00", "#FFFF00", "#FF0000" ],
    exaggeration: 1,
    blur: 20
}

export const useHeatmapSettingStore = createSelectors(create<State & Actions>(
    devtools(
        combine(
            initialState, (set, get) => ({
                setColors: (colors) => set({ colors }),
                setExaggeration: (value) => {
                    const exaggerationMin = 0.1;
                    const exaggerationMax = 2;
                    const blurMin = 1;
                    const blurMax = 20;

                    const ratio = (value - exaggerationMin) / (exaggerationMax - exaggerationMin);
                    const blur = blurMax - ratio * (blurMax - blurMin);
                    set({ exaggeration: value, blur }); // exaggeration과 blur 함께 업데이트
                }
            })
        ),
    )
));
