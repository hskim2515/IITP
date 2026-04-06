import React, { forwardRef } from 'react';
import 'ol/ol.css';

interface MapOLProps {
    style?: React.CSSProperties;
}

const MapOL = forwardRef<HTMLDivElement, MapOLProps>(({ style }, ref) => {
    return (
        <div style={{ position: "relative", ...style }}>
            <div ref={ref} style={{ width: "100%", height: "100%" }} />
        </div>
    );
});

export default MapOL;
