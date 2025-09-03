package com.iitp.iitp_rest.mapper.network;


import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.link.Link;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class LinkMapper {

    private final LaneMapper laneMapper;

    public Link toEntity(LinkResponse dto
            , Network network
    ) {
        return Link.builder()
                .id(dto.getId())
                .network(network)
                .fromNode(dto.getFromNode())
                .toNode(dto.getToNode())
                .numLane(dto.getNumLane())
                .length(dto.getLength())
                .width(dto.getWidth())
                .minSpd(dto.getMinSpd())
                .maxSpd(dto.getMaxSpd())
                .ffSpd(dto.getFfSpd())
                .waveSpd(dto.getWaveSpd())
                .qmax(dto.getQmax())
                .maxVeh(dto.getMaxVeh())
                .simType(dto.getSimType())
                .type(dto.getType())
                .layer(dto.getLayer())
                .stopLine(dto.getStopLine())
                .shape(dto.getShape())
                .build();
    }

    public List<Link> toEntities(List<LinkResponse> list, Network network) {
        if (list == null || list.isEmpty()) return List.of();
        List<Link> out = new ArrayList<>(list.size());
        for (LinkResponse dto : list) {
            out.add(toEntity(dto, network));
        }
        return out;
    }

    public LinkResponse toDto(Link entity) {
        if (entity == null) return null;
        LinkResponse dto = new LinkResponse();
        dto.setId(entity.getId());
        dto.setFromNode(entity.getFromNode());
        dto.setToNode(entity.getToNode());
        dto.setNumLane(entity.getNumLane());
        dto.setLength(entity.getLength());
        dto.setWidth(entity.getWidth());
        dto.setMaxSpd(entity.getMaxSpd());
        dto.setMinSpd(entity.getMinSpd());
        dto.setFfSpd(entity.getFfSpd());
        dto.setWaveSpd(entity.getWaveSpd());
        dto.setQmax(entity.getQmax());
        dto.setMaxVeh(entity.getMaxVeh());
        dto.setSimType(entity.getSimType());
        dto.setType(entity.getType());
        dto.setStopLine(entity.getStopLine());
        dto.setShape(entity.getShape());

        dto.setLanes(laneMapper.toDtos(entity.getLanes()));
        return dto;
    }

    public List<LinkResponse> toDtos(List<Link> entities) {
        if (entities == null) return new ArrayList<>();
        return entities.stream().map(e -> toDto(e)).collect(Collectors.toList());
    }
}
