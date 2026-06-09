import { Fill, Stroke, Style } from "ol/style";
import CircleStyle from "ol/style/Circle";
import { RegularShape } from "ol/style";

export const SELECTED_STROKE_COLOR = "rgba(255, 204, 64, 0.95)";
export const SELECTED_FILL_COLOR = "rgba(255, 204, 64, 0.22)";
export const SELECTED_LINE_DASH = [8, 6];
export const HOVERED_SELECTED_STROKE_COLOR = "rgba(255, 235, 140, 1)";
export const HOVERED_SELECTED_FILL_COLOR = "rgba(255, 235, 140, 0.34)";

export const createFallbackSelectedStyle = () => (
    new Style({
        stroke: new Stroke({
            color: SELECTED_STROKE_COLOR,
            width: 4,
            lineDash: SELECTED_LINE_DASH,
        }),
        fill: new Fill({ color: SELECTED_FILL_COLOR }),
        image: new CircleStyle({
            radius: 7,
            fill: new Fill({ color: SELECTED_FILL_COLOR }),
            stroke: new Stroke({ color: SELECTED_STROKE_COLOR, width: 3 }),
        }),
        zIndex: 300,
    })
);

export const getSelectedOlStyle = (baseStyle: Style | Style[] | null | undefined) => {
    if (!baseStyle) return undefined;

    const styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];

    return styles.map((style) => {
        const selectedStyle = style.clone();
        const image = selectedStyle.getImage();
        const stroke = selectedStyle.getStroke();
        const fill = selectedStyle.getFill();

        if (image instanceof CircleStyle || image instanceof RegularShape) {
            image.getFill()?.setColor(SELECTED_FILL_COLOR);
            image.getStroke()?.setColor(SELECTED_STROKE_COLOR);
            image.getStroke()?.setWidth(3);
        }

        if (stroke) {
            stroke.setColor(SELECTED_STROKE_COLOR);
            stroke.setWidth(Math.max((stroke.getWidth() ?? 1) + 2, 4));
            stroke.setLineDash(SELECTED_LINE_DASH);
            stroke.setLineDashOffset(0);
        }

        if (fill) {
            fill.setColor(SELECTED_FILL_COLOR);
        }

        selectedStyle.setZIndex(300);
        return selectedStyle;
    });
};

export const getHoveredSelectedOlStyle = (baseStyle: Style | Style[] | null | undefined) => {
    if (!baseStyle) return undefined;

    const styles = Array.isArray(baseStyle) ? baseStyle : [baseStyle];

    return styles.map((style) => {
        const hoveredStyle = style.clone();
        const image = hoveredStyle.getImage();
        const stroke = hoveredStyle.getStroke();
        const fill = hoveredStyle.getFill();

        if (image instanceof CircleStyle || image instanceof RegularShape) {
            image.getFill()?.setColor(HOVERED_SELECTED_FILL_COLOR);
            image.getStroke()?.setColor(HOVERED_SELECTED_STROKE_COLOR);
            image.getStroke()?.setWidth(4);
        }

        if (stroke) {
            stroke.setColor(HOVERED_SELECTED_STROKE_COLOR);
            stroke.setWidth(Math.max((stroke.getWidth() ?? 1) + 4, 6));
            stroke.setLineDash([6, 4]);
            stroke.setLineDashOffset(0);
        }

        if (fill) {
            fill.setColor(HOVERED_SELECTED_FILL_COLOR);
        }

        hoveredStyle.setZIndex(360);
        return hoveredStyle;
    });
};
