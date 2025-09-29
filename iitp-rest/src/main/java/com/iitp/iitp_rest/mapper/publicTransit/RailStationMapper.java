package com.iitp.iitp_rest.mapper.publicTransit;

import com.iitp.iitp_rest.config.GlobalMapperConfig;
import com.iitp.iitp_rest.model.publicTransit.rail.*;
import org.mapstruct.Mapper;

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

}
