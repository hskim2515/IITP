package com.iitp.iitp_rest.model.network.connection;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ConnectionResponse {
    private Long id;
    private Long fromLink;
    private Long fromLane;
    private Long toLink;
    private Long toLane;
    private Turning turning;
    private double length;
    private double width;
    private double ffSpd;
    private String shape;
    private List<Coordinates> coordinates = new ArrayList<>();
}
