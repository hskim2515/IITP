package com.iitp.iitp_rest.model.signal;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class SignalNodeData {
    private String id;
    private List<TurnData> turns = new ArrayList<>();
    private List<PlanData> plans = new ArrayList<>();
}
