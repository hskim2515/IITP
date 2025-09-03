package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.link.LaneResponse;
import com.iitp.iitp_rest.model.network.link.Lane;
import com.iitp.iitp_rest.model.network.link.Link;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class LaneMapper {

    private final SegmentMapper segmentMapper;
    private final CellMapper cellMapper;

    public Lane toEntity(LaneResponse dto, Link link) {
        return Lane.builder()
                .id(dto.getId())
                .link(link)
                .leftLaneId(dto.getLeftLaneId())
                .rightLaneId(dto.getRightLaneId())
                .numCell(dto.getNumCell())
                .laneAccessType(defaultIfBlank(dto.getLaneAccessType(), ""))
                .rightLC(dto.isRightLC())
                .leftLC(dto.isLeftLC())
                .shape(dto.getShape())                                  // 원문 보존
                .build();
    }

    /** 리스트 변환 */
    public List<Lane> toEntities(List<LaneResponse> list, Link link) {
        if (list == null || list.isEmpty()) return List.of();
        List<Lane> out = new ArrayList<>(list.size());
        for (LaneResponse dto : list) {
            out.add(toEntity(dto, link));
        }
        return out;
    }

    public LaneResponse toDto(Lane entity) {
        if (entity == null) return null;
        LaneResponse dto = new LaneResponse();
        dto.setId(entity.getId());
        dto.setLeftLaneId(entity.getLeftLaneId());
        dto.setRightLaneId(entity.getRightLaneId());
        dto.setNumCell(entity.getNumCell());
        dto.setLaneAccessType(entity.getLaneAccessType());
        dto.setRightLC(entity.getRightLC());
        dto.setLeftLC(entity.getLeftLC());
        dto.setShape(entity.getShape());

        dto.setSegments(segmentMapper.toDtos(entity.getSegments()));
        dto.setCells(cellMapper.toDtos(entity.getCells()));
        return dto;
    }

    public List<LaneResponse> toDtos(List<Lane> entities) {
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
    private int defaultIfNull(Integer v, int def) { return v != null ? v : def; }
    private String defaultIfBlank(String s, String def) {
        if (s == null) return def;
        String t = s.trim();
        return t.isEmpty() ? def : t;
    }
}
