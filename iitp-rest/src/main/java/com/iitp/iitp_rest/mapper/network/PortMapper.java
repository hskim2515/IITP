package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.node.Node;
import com.iitp.iitp_rest.model.network.port.Port;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import com.iitp.iitp_rest.model.network.port.PortXmlResponse;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class PortMapper {

    public Port xmlToEntity(PortXmlResponse dto, Node node) {
        if (dto == null) return null;

        return Port.builder()
                .node(node)
                .linkId(dto.getLinkId())
                .direction(dto.getDirection())
                // XML의 direction 속성은 비어있을 수 있으므로 기본값(e.g., 0) 처리
                .type(dto.getType())
                .build();
    }

    public List<Port> xmlToEntities(List<PortXmlResponse> list, Node node) {
        if (list == null || list.isEmpty()) return new ArrayList<>();
        List<Port> out = new ArrayList<>(list.size());
        for (PortXmlResponse dto : list) {
            out.add(xmlToEntity(dto, node));
        }
        return out;
    }

    public PortResponse entityToResponse(Port entity) {
        if (entity == null) return null;
        PortResponse dto = new PortResponse();
        dto.setLinkId(entity.getLinkId());
        dto.setType(entity.getType());
        dto.setDirection(entity.getDirection());
        return dto;
    }

    public PortXmlResponse toDto(Port entity) {
        if (entity == null) return null;
        PortXmlResponse dto = new PortXmlResponse();
        dto.setLinkId(entity.getLinkId());
        dto.setType(entity.getType());
        dto.setDirection(entity.getDirection());
        return dto;
    }

    public List<PortXmlResponse> toDtos(List<Port> entities) {
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