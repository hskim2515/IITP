package com.iitp.iitp_rest.model.pavementMarking;

import lombok.Data;

import java.util.List;

@Data
public class RoadAssetData {
    private List<PavementMarkingData> pavementMarkings;
}
