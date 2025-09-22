package com.iitp.iitp_rest.mapper.publicTransit;

import com.iitp.iitp_rest.config.GlobalMapperConfig;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationXml;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXml;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import java.util.List;

@Mapper(config = GlobalMapperConfig.class)
public interface BusStationMapper {

    // Root
    PublicTransitResponse toResponse(PublicTransitXml src);

    List<BusStationResponse> toBusStationResponseList(List<BusStationXml> src);

    // Station
    @Mapping(target = "address", ignore = true) // XML에 없으면 무시
    BusStationResponse toBusStationResponse(BusStationXml src);
}
