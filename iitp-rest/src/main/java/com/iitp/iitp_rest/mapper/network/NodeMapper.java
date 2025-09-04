package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.node.Node;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeTreeResponse;
import com.iitp.iitp_rest.model.network.node.NodeXmlResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class NodeMapper {

    private final PortMapper portMapper;
    private final ConnectionMapper connectionMapper;


    public Node xmlToEntity(NodeXmlResponse dto
            , Network network
    ) {
        return Node.builder()
                .id(Long.valueOf(dto.getId()))
                .network(network)
                .type(dto.getType())
                .numPort(dto.getNumPort())
                .numConnection(dto.getNumConnection())
                .v2x(dto.getV2x())
                .center(dto.getCenter())
                .build();
    }

    public NodeResponse entityToResponse(Node entity) {
        if (entity == null) return null;
        NodeResponse dto = new NodeResponse();
        dto.setId(entity.getId());
        dto.setType(entity.getType());
        dto.setNumPort(entity.getNumPort());
        dto.setNumConnection(entity.getNumConnection());
        dto.setV2x(entity.getV2x());
        dto.setCenter(entity.getCenter());
        return dto;
    }

    public NodeTreeResponse entityToTreeResponse(Node entity) {
        if (entity == null) return null;
        NodeTreeResponse dto = new NodeTreeResponse();
        dto.setId(entity.getId());
        dto.setType(entity.getType());
        dto.setNumPort(entity.getNumPort());
        dto.setNumConnection(entity.getNumConnection());
        dto.setV2x(entity.getV2x());
        dto.setCenter(entity.getCenter());
        return dto;
    }

    public List<Node> xmlToEntities(List<NodeXmlResponse> dtos, Network network) {
        if (dtos == null || dtos.isEmpty()) return List.of();
        List<Node> out = new ArrayList<>(dtos.size());
        for (NodeXmlResponse dto : dtos) {
            out.add(xmlToEntity(dto, network));
        }
        return out;
    }

    public NodeXmlResponse toDto(Node entity) {
        if (entity == null) return null;
        NodeXmlResponse dto = new NodeXmlResponse();
        dto.setId(entity.getId());
        dto.setType(entity.getType());
        dto.setNumPort(entity.getNumPort());
        dto.setNumConnection(entity.getNumConnection());
        dto.setV2x(entity.getV2x());
        dto.setCenter(entity.getCenter());
        dto.setPorts(portMapper.toDtos(entity.getPorts()));
        dto.setConnections(connectionMapper.toDtos(entity.getConnections()));
        return dto;
    }

    public List<NodeXmlResponse> toDtos(List<Node> entities) {
        if (entities == null) return new ArrayList<>();
        return entities.stream().map(e -> toDto(e)).collect(Collectors.toList());
    }

}
