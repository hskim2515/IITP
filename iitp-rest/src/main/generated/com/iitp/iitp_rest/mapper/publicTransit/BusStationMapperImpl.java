package com.iitp.iitp_rest.mapper.publicTransit;

import com.iitp.iitp_rest.model.publicTransit.bus.BusLineResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.BusLineXml;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationXml;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXml;
import java.util.ArrayList;
import java.util.List;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-03-09T09:09:23+0900",
    comments = "version: 1.6.3, compiler: javac, environment: Java 23.0.2 (Amazon.com Inc.)"
)
@Component
public class BusStationMapperImpl implements BusStationMapper {

    @Override
    public PublicTransitResponse toResponse(PublicTransitXml src) {
        if ( src == null ) {
            return null;
        }

        PublicTransitResponse publicTransitResponse = new PublicTransitResponse();

        List<BusStationResponse> list = toBusStationResponseList( src.getBusStations() );
        if ( list != null ) {
            publicTransitResponse.setBusStations( list );
        }

        return publicTransitResponse;
    }

    @Override
    public List<BusStationResponse> toBusStationResponseList(List<BusStationXml> src) {
        if ( src == null ) {
            return new ArrayList<BusStationResponse>();
        }

        List<BusStationResponse> list = new ArrayList<BusStationResponse>( src.size() );
        for ( BusStationXml busStationXml : src ) {
            list.add( toBusStationResponse( busStationXml ) );
        }

        return list;
    }

    @Override
    public BusStationResponse toBusStationResponse(BusStationXml src) {
        if ( src == null ) {
            return null;
        }

        BusStationResponse busStationResponse = new BusStationResponse();

        if ( src.getId() != null ) {
            busStationResponse.setId( String.valueOf( src.getId() ) );
        }
        if ( src.getTransitMode() != null ) {
            busStationResponse.setTransitMode( src.getTransitMode() );
        }
        if ( src.getLinkRef() != null ) {
            busStationResponse.setLinkRef( src.getLinkRef() );
        }
        if ( src.getLaneRef() != null ) {
            busStationResponse.setLaneRef( Long.parseLong( src.getLaneRef() ) );
        }
        if ( src.getOffset() != null ) {
            busStationResponse.setOffset( src.getOffset() );
        }
        if ( src.getType() != null ) {
            busStationResponse.setType( src.getType() );
        }
        if ( src.getParkingLots() != null ) {
            busStationResponse.setParkingLots( Integer.parseInt( src.getParkingLots() ) );
        }
        if ( src.getCenter() != null ) {
            busStationResponse.setCenter( src.getCenter() );
        }
        if ( src.getLine() != null ) {
            busStationResponse.setLine( busLineXmlToBusLineResponse( src.getLine() ) );
        }

        return busStationResponse;
    }

    protected BusLineResponse busLineXmlToBusLineResponse(BusLineXml busLineXml) {
        if ( busLineXml == null ) {
            return null;
        }

        BusLineResponse busLineResponse = new BusLineResponse();

        if ( busLineXml.getList() != null ) {
            busLineResponse.setList( busLineXml.getList() );
        }

        return busLineResponse;
    }
}
