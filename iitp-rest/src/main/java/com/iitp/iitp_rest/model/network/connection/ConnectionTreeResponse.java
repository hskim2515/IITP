package com.iitp.iitp_rest.model.network.connection;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
public class ConnectionTreeResponse {
    private Long nodeId;
    private Long id;
    private Long fromLink;
    private Long fromLane;
    private Coordinates fromLaneCoordinates;
    private Long toLink;
    private Long toLane;
    private Coordinates toLaneCoordinates;
    private Turning turning;
    private double length;
    private double width;
    private double ffSpd;
    private String shape;
    private List<Coordinates> coordinates;

    public ConnectionTreeResponse(Long nodeId, Long id, Long fromLink, Long fromLane, Long toLink, Long toLane, Turning turning, double length, double width, double ffSpd, String shape) {
        this.nodeId = nodeId;
        this.id = id;
        this.fromLink = fromLink;
        this.fromLane = fromLane;
        this.toLink = toLink;
        this.toLane = toLane;
        this.turning = turning;
        this.length = length;
        this.width = width;
        this.ffSpd = ffSpd;
        this.shape = shape;
    }
}
