import React, {forwardRef,useRef} from 'react';
import 'ol/ol.css';

const MapOL = forwardRef(({style} , ref) => {

    return (
        <div style={{ position: "relative", ...style }}>
            <div ref={ref}  style={{ width: "100%", height: "90vh" }} />
        </div>
    );
});

export default MapOL;
