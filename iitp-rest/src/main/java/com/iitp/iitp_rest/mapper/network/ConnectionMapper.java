package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.node.*;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class ConnectionMapper {
    public Connection toEntity(ConnectionResponse dto, Node node) {
        if (dto == null) return null;

        return Connection.builder()
                .id(Long.valueOf(dto.getId()))
                .node(node)
                .turning(dto.getTurning())
                .length(dto.getLength())
                .width(dto.getWidth())
                .ffSpd(dto.getFfSpd())
                .shape(dto.getShape())
                .build();
    }

    public List<Connection> toEntities(List<ConnectionResponse> list, Node node) {
        if (list == null || list.isEmpty()) return new ArrayList<>();
        List<Connection> out = new ArrayList<>(list.size());
        for (ConnectionResponse dto : list) {
            out.add(toEntity(dto, node));
        }
        return out;
    }

    public ConnectionResponse toDto(Connection entity) {
        if (entity == null) return null;
        ConnectionResponse dto = new ConnectionResponse();
        dto.setId(entity.getId());
        dto.setFromLink(entity.getFromLink());
        dto.setToLink(entity.getToLink());
        dto.setFromLane(entity.getFromLane());
        dto.setToLane(entity.getToLane());
        dto.setTurning(entity.getTurning());
        dto.setLength(entity.getLength());
        dto.setWidth(entity.getWidth());
        dto.setFfSpd(entity.getFfSpd());
        dto.setShape(entity.getShape());
        return dto;
    }

    public List<ConnectionResponse> toDtos(List<Connection> entities) {
        if (entities == null) return new ArrayList<>();
        return entities.stream().map(e -> toDto(e)).collect(Collectors.toList());
    }

    private int parseIntOrDefault(String s, int def) {
        if (s == null) return def;
        String v = s.trim();
        if (v.isEmpty()) return def;
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return def;
        }
    }
}
