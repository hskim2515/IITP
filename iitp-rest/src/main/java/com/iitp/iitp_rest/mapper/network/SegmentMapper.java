package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.lane.Lane;
import com.iitp.iitp_rest.model.network.segment.Segment;
import com.iitp.iitp_rest.model.network.segment.SegmentResponse;
import com.iitp.iitp_rest.model.network.segment.SegmentXmlResponse;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class SegmentMapper {

    public Segment xmlToEntity(SegmentXmlResponse dto, Lane lane) {
        if (dto == null) return null;

        return Segment.builder()
                .id(dto.getId())
                .lane(lane)
                .block(dto.getBlock())
                .initPoint(dto.getInitPoint())
                .endPoint(dto.getEndPoint())
                .build();
    }

    public List<Segment> xmlToEntities(List<SegmentXmlResponse> list, Lane lane) {
        if (list == null || list.isEmpty()) return new ArrayList<>();
        List<Segment> out = new ArrayList<>(list.size());
        for (SegmentXmlResponse dto : list) {
            out.add(xmlToEntity(dto, lane));
        }
        return out;
    }

    public SegmentResponse entityToResponse(Segment entity) {
        if (entity == null) return null;
        SegmentResponse dto = new SegmentResponse();
        dto.setId(entity.getId());
        dto.setBlock(entity.getBlock());
        dto.setEndPoint(entity.getEndPoint());
        dto.setInitPoint(entity.getInitPoint());
        return dto;
    }

    public SegmentXmlResponse toDto(Segment entity) {
        if (entity == null) return null;
        SegmentXmlResponse dto = new SegmentXmlResponse();
        dto.setId(entity.getId());
        dto.setBlock(entity.getBlock());
        dto.setEndPoint(entity.getEndPoint());
        dto.setInitPoint(entity.getInitPoint());
        return dto;
    }

    public List<SegmentXmlResponse> toDtos(List<Segment> entities) {
        if (entities == null) return new ArrayList<>();
        return entities.stream().map(e -> toDto(e)).collect(Collectors.toList());
    }

    private int parseIntOrDefault(String s, int def) {
        if (s == null) return def;
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }
}