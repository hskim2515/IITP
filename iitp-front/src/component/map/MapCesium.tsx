import React, { forwardRef } from 'react';

interface MapCesiumProps {
    style?: React.CSSProperties;
}

const MapCesium = forwardRef<HTMLDivElement, MapCesiumProps>(({ style }, ref) => {

    return (
        <div style={{ position: "relative", ...style }}>
            <div ref={ref} style={{ width: "100%", height: "100%" }}  />
        </div>
    );
});

export default MapCesium;
