package com.iitp.iitp_rest.model.network.connection;

import lombok.Data;

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
}
