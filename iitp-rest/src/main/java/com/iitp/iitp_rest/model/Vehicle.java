package com.iitp.iitp_rest.model;

import com.iitp.iitp_rest.model.geometry.Cartesian3;
import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Vehicle{
    private String id;
    private Cartesian3 position;
    private boolean display;
}
