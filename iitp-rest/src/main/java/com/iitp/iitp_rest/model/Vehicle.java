package com.iitp.iitp_rest.model;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Vehicle{
    private String id;
    private double lon;
    private double lat;
    private double height;
    private String displayType;
}
