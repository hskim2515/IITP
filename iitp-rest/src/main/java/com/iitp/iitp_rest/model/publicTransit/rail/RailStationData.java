package com.iitp.iitp_rest.model.publicTransit.rail;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RailStationData {
    private String id;
    private String transitMode;
    private String address;
    private String center;
    @Builder.Default
    private List<ExitData> exits = new ArrayList<>();
    @Builder.Default
    private List<TimetableData> timetables = new ArrayList<>();
    @Builder.Default
    private List<String> lineList = new ArrayList<>();
    private Coordinates coordinates;

    @Data // 임시
    public static class TimetableData {
        private String dayOfWeek;
        private String lineId;
        private List<String> times;
    }
}
