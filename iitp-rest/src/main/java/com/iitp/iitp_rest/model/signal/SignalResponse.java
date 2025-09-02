package com.iitp.iitp_rest.model.signal;

import lombok.Data;

@Data
public class SignalResponse {
    private String nodeId;
    private String turnId;
    private String turning;
    private String type;
    //private List<String> connList = new ArrayList<>();
    private String connectionId;
    private String __guid;
}

