package com.iitp.iitp_rest.model.geometry;

import lombok.Data;

@Data
public class Coordinates {
    /** baseLat + y * scaleY */
    private Double lat;
    /** baseLng + x * scaleX */
    private Double lng;
}
