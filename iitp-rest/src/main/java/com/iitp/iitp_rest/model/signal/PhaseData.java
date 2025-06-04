package com.iitp.iitp_rest.model.signal;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class PhaseData {
    private String id;
    private int duration;
    private List<String> turnList = new ArrayList<>();
}
