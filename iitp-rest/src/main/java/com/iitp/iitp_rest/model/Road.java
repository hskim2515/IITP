package com.iitp.iitp_rest.model;

import com.iitp.iitp_rest.model.geometry.Polyline;
import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Road {
    private String linkId;
    private String laneId;
    private Polyline polyline;

    private Double baseEasting;
    private Double baseNorthing;

}
