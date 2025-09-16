package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.config.GlobalMapperConfig;

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

import org.mapstruct.*;

import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

@Mapper(config = GlobalMapperConfig.class)
public interface NetworkMapper {

    // Root
    NetworkResponse toResponse(NetworkXml src);

    List<NetworkResponse> toResponseList(List<NetworkXml> srcList);

    // Node
    NodeResponse toResponse(NodeXml src);

    List<NodeResponse> toNodeResponseList(List<NodeXml> src);

    @AfterMapping
    default void fillPortLinkIds(NodeXml src, @MappingTarget NodeResponse dst) {
        if (dst == null) return;
        if (dst.getPortLinkIds() != null && !dst.getPortLinkIds().isEmpty()) return;

        if (src.getPorts() != null) {
            List<String> ids = src.getPorts().stream()
                    .filter(Objects::nonNull)
                    .map(PortXml::getLinkId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());
            dst.setPortLinkIds(ids);
        }
    }

    // Port
    PortResponse toResponse(PortXml src);
    List<PortResponse> toPortResponseList(List<PortXml> src);

    // Connection
    ConnectionResponse toResponse(ConnectionXml src);
    List<ConnectionResponse> toConnectionResponseList(List<ConnectionXml> src);

    // Link
    LinkResponse toResponse(LinkXml src);
    List<LinkResponse> toLinkResponseList(List<LinkXml> src);

    // Lane
    LaneResponse toResponse(LaneXml src);
    List<LaneResponse> toLaneResponseList(List<LaneXml> src);

    // Segment
    SegmentResponse toResponse(SegmentXml src);
    List<SegmentResponse> toSegmentResponseList(List<SegmentXml> src);

    // Cell
    CellResponse toResponse(CellXml src);
    List<CellResponse> toCellResponseList(List<CellXml> src);

    // Section
    SectionResponse toResponse(SectionXml src);
    List<SectionResponse> toSectionResponseList(List<SectionXml> src);
}