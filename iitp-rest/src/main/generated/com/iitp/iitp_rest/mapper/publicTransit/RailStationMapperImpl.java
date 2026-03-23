package com.iitp.iitp_rest.mapper.publicTransit;

import com.iitp.iitp_rest.model.publicTransit.rail.ExitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.ExitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.RailStationXml;
import com.iitp.iitp_rest.model.publicTransit.rail.TimetableResponse;
import com.iitp.iitp_rest.model.publicTransit.rail.TimetableXml;
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
public class RailStationMapperImpl implements RailStationMapper {

    @Override
    public RailPublicTransitResponse toResponse(RailPublicTransitXml src) {
        if ( src == null ) {
            return null;
        }

        RailPublicTransitResponse railPublicTransitResponse = new RailPublicTransitResponse();

        List<RailStationResponse> list = toStationList( src.getRailStations() );
        if ( list != null ) {
            railPublicTransitResponse.setRailStations( list );
        }

        return railPublicTransitResponse;
    }

    @Override
    public RailStationResponse toStation(RailStationXml src) {
        if ( src == null ) {
            return null;
        }

        RailStationResponse railStationResponse = new RailStationResponse();

        if ( src.getId() != null ) {
            railStationResponse.setId( String.valueOf( src.getId() ) );
        }
        if ( src.getTransitMode() != null ) {
            railStationResponse.setTransitMode( src.getTransitMode() );
        }
        if ( src.getLineList() != null ) {
            railStationResponse.setLineList( src.getLineList() );
        }
        if ( src.getType() != null ) {
            railStationResponse.setType( src.getType() );
        }
        if ( src.getAddress() != null ) {
            railStationResponse.setAddress( src.getAddress() );
        }
        if ( src.getCenter() != null ) {
            railStationResponse.setCenter( src.getCenter() );
        }
        List<ExitResponse> list = toExitList( src.getExits() );
        if ( list != null ) {
            railStationResponse.setExits( list );
        }
        if ( src.getCoordinates() != null ) {
            railStationResponse.setCoordinates( src.getCoordinates() );
        }

        return railStationResponse;
    }

    @Override
    public List<RailStationResponse> toStationList(List<RailStationXml> src) {
        if ( src == null ) {
            return new ArrayList<RailStationResponse>();
        }

        List<RailStationResponse> list = new ArrayList<RailStationResponse>( src.size() );
        for ( RailStationXml railStationXml : src ) {
            list.add( toStation( railStationXml ) );
        }

        return list;
    }

    @Override
    public ExitResponse toExit(ExitXml src) {
        if ( src == null ) {
            return null;
        }

        ExitResponse exitResponse = new ExitResponse();

        if ( src.getId() != null ) {
            exitResponse.setId( String.valueOf( src.getId() ) );
        }
        if ( src.getLinkRef() != null ) {
            exitResponse.setLinkRef( String.valueOf( src.getLinkRef() ) );
        }
        if ( src.getOffset() != null ) {
            exitResponse.setOffset( src.getOffset() );
        }
        if ( src.getAccessTime() != null ) {
            exitResponse.setAccessTime( String.valueOf( src.getAccessTime() ) );
        }
        if ( src.getCoord() != null ) {
            exitResponse.setCoord( src.getCoord() );
        }

        return exitResponse;
    }

    @Override
    public List<ExitResponse> toExitList(List<ExitXml> src) {
        if ( src == null ) {
            return new ArrayList<ExitResponse>();
        }

        List<ExitResponse> list = new ArrayList<ExitResponse>( src.size() );
        for ( ExitXml exitXml : src ) {
            list.add( toExit( exitXml ) );
        }

        return list;
    }

    @Override
    public TimetableResponse toTimetable(TimetableXml src) {
        if ( src == null ) {
            return null;
        }

        TimetableResponse timetableResponse = new TimetableResponse();

        if ( src.getDayOfWeek() != null ) {
            timetableResponse.setDayOfWeek( src.getDayOfWeek().name() );
        }
        if ( src.getLineId() != null ) {
            timetableResponse.setLineId( src.getLineId() );
        }

        return timetableResponse;
    }

    @Override
    public List<TimetableResponse> toTimetableList(List<TimetableXml> src) {
        if ( src == null ) {
            return new ArrayList<TimetableResponse>();
        }

        List<TimetableResponse> list = new ArrayList<TimetableResponse>( src.size() );
        for ( TimetableXml timetableXml : src ) {
            list.add( toTimetable( timetableXml ) );
        }

        return list;
    }
}
