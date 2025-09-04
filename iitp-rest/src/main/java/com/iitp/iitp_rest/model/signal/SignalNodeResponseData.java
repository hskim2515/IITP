package com.iitp.iitp_rest.model.signal;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class SignalNodeResponseData {
    private List<SignalResponse> signals = new ArrayList<>();
    //private List<PlanData> plans = new ArrayList<>();
}
