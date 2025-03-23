package com.iitp.iitp_rest.model.geometry;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Cartographic {
    private double longitude; // 경도 (radians)
    private double latitude;  // 위도 (radians)
    private double height;    // 고도 (meters)
}

