package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.link.*;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class SegmentMapper {

    public Segment toEntity(SegmentResponse dto, Lane lane) {
        if (dto == null) return null;

        return Segment.builder()
                .id(dto.getId())
                .lane(lane)
                .block(dto.isBlock())
                .initPoint(dto.getInitPoint())
                .endPoint(dto.getEndPoint())
                .build();
    }

    public List<Segment> toEntities(List<SegmentResponse> list, Lane lane) {
        if (list == null || list.isEmpty()) return new ArrayList<>();
        List<Segment> out = new ArrayList<>(list.size());
        for (SegmentResponse dto : list) {
            out.add(toEntity(dto, lane));
        }
        return out;
    }

    public SegmentResponse toDto(Segment entity) {
        if (entity == null) return null;
        SegmentResponse dto = new SegmentResponse();
        dto.setId(entity.getId());
        dto.setBlock(entity.getBlock());
        dto.setEndPoint(entity.getEndPoint());
        dto.setInitPoint(entity.getInitPoint());
        return dto;
    }

    public List<SegmentResponse> toDtos(List<Segment> entities) {
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