package com.iitp.iitp_rest.model.signal;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class SignalData {
    private String nodeId;
    private List<SignalNodeData> nodes = new ArrayList<>();
}
