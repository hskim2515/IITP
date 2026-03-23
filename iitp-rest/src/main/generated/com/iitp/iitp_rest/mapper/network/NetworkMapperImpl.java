package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.cell.CellResponse;
import com.iitp.iitp_rest.model.network.cell.CellXml;
import com.iitp.iitp_rest.model.network.connection.ConnectionResponse;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.lane.LaneResponse;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import com.iitp.iitp_rest.model.network.port.PortXml;
import com.iitp.iitp_rest.model.network.section.SectionResponse;
import com.iitp.iitp_rest.model.network.section.SectionXml;
import com.iitp.iitp_rest.model.network.segment.SegmentResponse;
import com.iitp.iitp_rest.model.network.segment.SegmentXml;
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
public class NetworkMapperImpl implements NetworkMapper {

    @Override
    public NetworkResponse toResponse(NetworkXml src) {
        if ( src == null ) {
            return null;
        }

        NetworkResponse networkResponse = new NetworkResponse();

        List<NodeResponse> list = toNodeResponseList( src.getNodes() );
        if ( list != null ) {
            networkResponse.setNodes( list );
        }
        List<LinkResponse> list1 = toLinkResponseList( src.getLinks() );
        if ( list1 != null ) {
            networkResponse.setLinks( list1 );
        }

        return networkResponse;
    }

    @Override
    public List<NetworkResponse> toResponseList(List<NetworkXml> srcList) {
        if ( srcList == null ) {
            return new ArrayList<NetworkResponse>();
        }

        List<NetworkResponse> list = new ArrayList<NetworkResponse>( srcList.size() );
        for ( NetworkXml networkXml : srcList ) {
            list.add( toResponse( networkXml ) );
        }

        return list;
    }

    @Override
    public NodeResponse toResponse(NodeXml src) {
        if ( src == null ) {
            return null;
        }

        NodeResponse nodeResponse = new NodeResponse();

        if ( src.getId() != null ) {
            nodeResponse.setId( src.getId() );
        }
        if ( src.getType() != null ) {
            nodeResponse.setType( src.getType() );
        }
        nodeResponse.setNumPort( src.getNumPort() );
        nodeResponse.setNumConnection( src.getNumConnection() );
        if ( src.getV2x() != null ) {
            nodeResponse.setV2x( src.getV2x() );
        }
        if ( src.getCenter() != null ) {
            nodeResponse.setCenter( src.getCenter() );
        }
        List<PortResponse> list = toPortResponseList( src.getPorts() );
        if ( list != null ) {
            nodeResponse.setPorts( list );
        }
        List<ConnectionResponse> list1 = toConnectionResponseList( src.getConnections() );
        if ( list1 != null ) {
            nodeResponse.setConnections( list1 );
        }
        if ( src.getCoordinates() != null ) {
            nodeResponse.setCoordinates( src.getCoordinates() );
        }
        List<String> list2 = src.getPortLinkIds();
        if ( list2 != null ) {
            nodeResponse.setPortLinkIds( new ArrayList<String>( list2 ) );
        }

        fillPortLinkIds( src, nodeResponse );

        return nodeResponse;
    }

    @Override
    public List<NodeResponse> toNodeResponseList(List<NodeXml> src) {
        if ( src == null ) {
            return new ArrayList<NodeResponse>();
        }

        List<NodeResponse> list = new ArrayList<NodeResponse>( src.size() );
        for ( NodeXml nodeXml : src ) {
            list.add( toResponse( nodeXml ) );
        }

        return list;
    }

    @Override
    public PortResponse toResponse(PortXml src) {
        if ( src == null ) {
            return null;
        }

        PortResponse portResponse = new PortResponse();

        if ( src.getType() != null ) {
            portResponse.setType( src.getType() );
        }
        if ( src.getLinkId() != null ) {
            portResponse.setLinkId( src.getLinkId() );
        }
        if ( src.getDirection() != null ) {
            portResponse.setDirection( src.getDirection() );
        }

        return portResponse;
    }

    @Override
    public List<PortResponse> toPortResponseList(List<PortXml> src) {
        if ( src == null ) {
            return new ArrayList<PortResponse>();
        }

        List<PortResponse> list = new ArrayList<PortResponse>( src.size() );
        for ( PortXml portXml : src ) {
            list.add( toResponse( portXml ) );
        }

        return list;
    }

    @Override
    public ConnectionResponse toResponse(ConnectionXml src) {
        if ( src == null ) {
            return null;
        }

        ConnectionResponse connectionResponse = new ConnectionResponse();

        if ( src.getId() != null ) {
            connectionResponse.setId( src.getId() );
        }
        if ( src.getFromLink() != null ) {
            connectionResponse.setFromLink( src.getFromLink() );
        }
        if ( src.getFromLane() != null ) {
            connectionResponse.setFromLane( src.getFromLane() );
        }
        if ( src.getToLink() != null ) {
            connectionResponse.setToLink( src.getToLink() );
        }
        if ( src.getToLane() != null ) {
            connectionResponse.setToLane( src.getToLane() );
        }
        if ( src.getTurning() != null ) {
            connectionResponse.setTurning( src.getTurning() );
        }
        connectionResponse.setLength( src.getLength() );
        connectionResponse.setWidth( src.getWidth() );
        connectionResponse.setFfSpd( src.getFfSpd() );
        if ( src.getShape() != null ) {
            connectionResponse.setShape( src.getShape() );
        }

        return connectionResponse;
    }

    @Override
    public List<ConnectionResponse> toConnectionResponseList(List<ConnectionXml> src) {
        if ( src == null ) {
            return new ArrayList<ConnectionResponse>();
        }

        List<ConnectionResponse> list = new ArrayList<ConnectionResponse>( src.size() );
        for ( ConnectionXml connectionXml : src ) {
            list.add( toResponse( connectionXml ) );
        }

        return list;
    }

    @Override
    public LinkResponse toResponse(LinkXml src) {
        if ( src == null ) {
            return null;
        }

        LinkResponse linkResponse = new LinkResponse();

        if ( src.getId() != null ) {
            linkResponse.setId( src.getId() );
        }
        if ( src.getFromNode() != null ) {
            linkResponse.setFromNode( src.getFromNode() );
        }
        if ( src.getToNode() != null ) {
            linkResponse.setToNode( src.getToNode() );
        }
        linkResponse.setNumLane( src.getNumLane() );
        linkResponse.setLength( src.getLength() );
        linkResponse.setWidth( src.getWidth() );
        linkResponse.setMaxSpd( src.getMaxSpd() );
        linkResponse.setMinSpd( src.getMinSpd() );
        linkResponse.setFfSpd( src.getFfSpd() );
        linkResponse.setWaveSpd( src.getWaveSpd() );
        linkResponse.setQmax( src.getQmax() );
        linkResponse.setMaxVeh( src.getMaxVeh() );
        if ( src.getSimType() != null ) {
            linkResponse.setSimType( src.getSimType() );
        }
        if ( src.getType() != null ) {
            linkResponse.setType( src.getType() );
        }
        if ( src.getLayer() != null ) {
            linkResponse.setLayer( src.getLayer() );
        }
        linkResponse.setStopLine( src.getStopLine() );
        if ( src.getShape() != null ) {
            linkResponse.setShape( src.getShape() );
        }
        List<LaneResponse> list = toLaneResponseList( src.getLanes() );
        if ( list != null ) {
            linkResponse.setLanes( list );
        }
        List<SectionResponse> list1 = toSectionResponseList( src.getSections() );
        if ( list1 != null ) {
            linkResponse.setSections( list1 );
        }
        List<Coordinates> list2 = src.getCoordinates();
        if ( list2 != null ) {
            linkResponse.setCoordinates( new ArrayList<Coordinates>( list2 ) );
        }

        return linkResponse;
    }

    @Override
    public List<LinkResponse> toLinkResponseList(List<LinkXml> src) {
        if ( src == null ) {
            return new ArrayList<LinkResponse>();
        }

        List<LinkResponse> list = new ArrayList<LinkResponse>( src.size() );
        for ( LinkXml linkXml : src ) {
            list.add( toResponse( linkXml ) );
        }

        return list;
    }

    @Override
    public LaneResponse toResponse(LaneXml src) {
        if ( src == null ) {
            return null;
        }

        LaneResponse laneResponse = new LaneResponse();

        if ( src.getId() != null ) {
            laneResponse.setId( src.getId() );
        }
        if ( src.getLeftLaneId() != null ) {
            laneResponse.setLeftLaneId( src.getLeftLaneId() );
        }
        if ( src.getRightLaneId() != null ) {
            laneResponse.setRightLaneId( src.getRightLaneId() );
        }
        laneResponse.setNumCell( src.getNumCell() );
        if ( src.getLaneAccessType() != null ) {
            laneResponse.setLaneAccessType( src.getLaneAccessType() );
        }
        laneResponse.setRightLC( src.isRightLC() );
        laneResponse.setLeftLC( src.isLeftLC() );
        if ( src.getShape() != null ) {
            laneResponse.setShape( src.getShape() );
        }
        List<SegmentResponse> list = toSegmentResponseList( src.getSegments() );
        if ( list != null ) {
            laneResponse.setSegments( list );
        }
        List<CellResponse> list1 = toCellResponseList( src.getCells() );
        if ( list1 != null ) {
            laneResponse.setCells( list1 );
        }

        return laneResponse;
    }

    @Override
    public List<LaneResponse> toLaneResponseList(List<LaneXml> src) {
        if ( src == null ) {
            return new ArrayList<LaneResponse>();
        }

        List<LaneResponse> list = new ArrayList<LaneResponse>( src.size() );
        for ( LaneXml laneXml : src ) {
            list.add( toResponse( laneXml ) );
        }

        return list;
    }

    @Override
    public SegmentResponse toResponse(SegmentXml src) {
        if ( src == null ) {
            return null;
        }

        SegmentResponse segmentResponse = new SegmentResponse();

        if ( src.getId() != null ) {
            segmentResponse.setId( src.getId() );
        }
        if ( src.getBlock() != null ) {
            segmentResponse.setBlock( src.getBlock() );
        }
        segmentResponse.setInitPoint( src.getInitPoint() );
        segmentResponse.setEndPoint( src.getEndPoint() );

        return segmentResponse;
    }

    @Override
    public List<SegmentResponse> toSegmentResponseList(List<SegmentXml> src) {
        if ( src == null ) {
            return new ArrayList<SegmentResponse>();
        }

        List<SegmentResponse> list = new ArrayList<SegmentResponse>( src.size() );
        for ( SegmentXml segmentXml : src ) {
            list.add( toResponse( segmentXml ) );
        }

        return list;
    }

    @Override
    public CellResponse toResponse(CellXml src) {
        if ( src == null ) {
            return null;
        }

        CellResponse cellResponse = new CellResponse();

        if ( src.getId() != null ) {
            cellResponse.setId( src.getId() );
        }
        cellResponse.setLength( src.getLength() );
        cellResponse.setOffset( src.getOffset() );

        return cellResponse;
    }

    @Override
    public List<CellResponse> toCellResponseList(List<CellXml> src) {
        if ( src == null ) {
            return new ArrayList<CellResponse>();
        }

        List<CellResponse> list = new ArrayList<CellResponse>( src.size() );
        for ( CellXml cellXml : src ) {
            list.add( toResponse( cellXml ) );
        }

        return list;
    }

    @Override
    public SectionResponse toResponse(SectionXml src) {
        if ( src == null ) {
            return null;
        }

        SectionResponse sectionResponse = new SectionResponse();

        if ( src.getId() != null ) {
            sectionResponse.setId( src.getId() );
        }
        if ( src.getLeftId() != null ) {
            sectionResponse.setLeftId( src.getLeftId() );
        }
        if ( src.getRightId() != null ) {
            sectionResponse.setRightId( src.getRightId() );
        }
        if ( src.getSlope() != null ) {
            sectionResponse.setSlope( src.getSlope() );
        }
        if ( src.getLength() != null ) {
            sectionResponse.setLength( src.getLength() );
        }
        if ( src.getOffset() != null ) {
            sectionResponse.setOffset( src.getOffset() );
        }

        return sectionResponse;
    }

    @Override
    public List<SectionResponse> toSectionResponseList(List<SectionXml> src) {
        if ( src == null ) {
            return new ArrayList<SectionResponse>();
        }

        List<SectionResponse> list = new ArrayList<SectionResponse>( src.size() );
        for ( SectionXml sectionXml : src ) {
            list.add( toResponse( sectionXml ) );
        }

        return list;
    }
}
