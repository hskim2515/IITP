package com.iitp.iitp_rest.model.network;

import lombok.Data;

@Data
public class ConnectionData {
    public String id;
    public String fromLink;
    public int fromLane;
    public String toLink;
    public int toLane;
    public String turning;
    public double length;
    public double width;
    public double ffSpd;
}
