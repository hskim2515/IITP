package com.iitp.iitp_rest.model.signal;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class TurnData {
    private String id;
    private String turning;
    private String type;
    private List<String> connList = new ArrayList<>();
}
