package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.node.Node;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
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


    public Node toEntity(NodeResponse dto
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

    public List<Node> toEntities(List<NodeResponse> dtos, Network network) {
        if (dtos == null || dtos.isEmpty()) return List.of();
        List<Node> out = new ArrayList<>(dtos.size());
        for (NodeResponse dto : dtos) {
            out.add(toEntity(dto, network));
        }
        return out;
    }

    public NodeResponse toDto(Node entity) {
        if (entity == null) return null;
        NodeResponse dto = new NodeResponse();
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

    public List<NodeResponse> toDtos(List<Node> entities) {
        if (entities == null) return new ArrayList<>();
        return entities.stream().map(e -> toDto(e)).collect(Collectors.toList());
    }

}
