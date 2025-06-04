package com.iitp.iitp_rest.model.signal;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class PlanData {
    private String id;
    private int cycle;
    private int offset;
    private List<PhaseData> phases = new ArrayList<>();

}
