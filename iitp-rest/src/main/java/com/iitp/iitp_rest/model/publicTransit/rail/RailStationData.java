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
    private List<ExitData> exits = new ArrayList<>();
    private List<TimetableData> timetables = new ArrayList<>();
    private List<String> lineList = new ArrayList<>();
    private List<Coordinates> coordinates = new ArrayList<>();

    @Data // 임시
    public static class TimetableData {
        private String dayOfWeek;
        private String lineId;
        private List<String> times;
    }
}
