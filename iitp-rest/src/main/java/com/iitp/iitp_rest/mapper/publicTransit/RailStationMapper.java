package com.iitp.iitp_rest.mapper.publicTransit;

import com.iitp.iitp_rest.config.GlobalMapperConfig;
import com.iitp.iitp_rest.model.publicTransit.rail.ExitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.TimetableResponse;
import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.rail.ExitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationXml;
import com.iitp.iitp_rest.model.publicTransit.rail.TimetableXml;
import org.mapstruct.*;

import java.util.ArrayList;
import java.util.List;

@Mapper(config = GlobalMapperConfig.class)
public interface RailStationMapper {

    // Root
    RailPublicTransitResponse toResponse(RailPublicTransitXml src);

    // Station
    RailStationResponse toStation(RailStationXml src);

    List<RailStationResponse> toStationList(List<RailStationXml> src);

    // Exit
    ExitResponse toExit(ExitXml src);

    List<ExitResponse> toExitList(List<ExitXml> src);

    // Timetable
    TimetableResponse toTimetable(TimetableXml src);

    List<TimetableResponse> toTimetableList(List<TimetableXml> src);

    @AfterMapping
    default void fillStationCoordinates(RailStationXml src, @MappingTarget RailStationResponse dst) {
        // 원본 coordinates가 있으면 그대로 사용(자동 매핑 결과 활용)
        // 없으면 center 문자열에서 파싱
        if (dst.getCoordinates() == null) {
            Coordinates parsed = parseLonLatToCoordinates(src.getCenter());
            if (parsed != null) dst.setCoordinates(parsed);
        }
        if (dst.getExits() == null) dst.setExits(new ArrayList<>());
        if (dst.getTimetables() == null) dst.setTimetables(new ArrayList<>());
    }

    @AfterMapping
    default void fillExitCoordinates(ExitXml src, @MappingTarget ExitResponse dst) {
        if (dst.getCoordinates() == null) {
            Coordinates parsed = parseLonLatToCoordinates(src.getCoord());
            if (parsed != null) dst.setCoordinates(parsed);
        }
    }

    default Coordinates newCoordinates(Double lat, Double lng) {
        if (lat == null || lng == null) return null;
        Coordinates r = new Coordinates();
        r.setLat(lat);
        r.setLng(lng);
        return r;
    }

    /**
     * 입력 문자열 형식:
     * - "lon,lat" 또는 "lon lat" (우선순위: 쉼표 → 공백)
     * - 예: "126.9780,37.5665" 또는 "126.9780 37.5665"
     * 반환: Coordinates(lat, lon)  // 주의: lat/long 순서 변환
     */
    default Coordinates parseLonLatToCoordinates(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;

        String[] parts = t.contains(",") ? t.split(",") : t.split("\\s+");
        if (parts.length != 2) return null;

        try {
            double lon = Double.parseDouble(parts[0].trim());
            double lat = Double.parseDouble(parts[1].trim());
            return newCoordinates(lat, lon);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
