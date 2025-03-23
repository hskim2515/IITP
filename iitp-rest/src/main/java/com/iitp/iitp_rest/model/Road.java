package com.iitp.iitp_rest.model;

import com.iitp.iitp_rest.model.geometry.Polyline;
import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Road {
    private Polyline polyline;
}
