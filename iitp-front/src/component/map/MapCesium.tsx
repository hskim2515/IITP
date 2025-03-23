import {forwardRef} from 'react';


const MapCesium= forwardRef(({style} , ref) => {

    return (
        <div style={{ position: "relative", ...style }}>
            <div ref={ref} style={{ width: "100%", height: "90vh" }}  />
        </div>
    );
});

export default MapCesium;
