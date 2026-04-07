package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class OverallSummaryResponse {
    private int totalVehicles;
    private int totalLinks;
    private double simulationDuration; // seconds
    private int peakVolume;
    private double peakTimestep;       // seconds from simulation start
}
