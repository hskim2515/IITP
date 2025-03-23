package com.iitp.iitp_rest.model.geometry;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class Polyline {
    private List<Cartesian3> positions;
}
