package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.cell.Cell;
import com.iitp.iitp_rest.model.network.cell.CellResponse;
import com.iitp.iitp_rest.model.network.cell.CellXmlResponse;
import com.iitp.iitp_rest.model.network.lane.Lane;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class CellMapper {
    public Cell xmlToEntity(CellXmlResponse dto, Lane lane) {
        if (dto == null) return null;

        return Cell.builder()
                .id(dto.getId())
                .lane(lane)
                .length(dto.getLength())
                .offset(dto.getOffset())
                .build();
    }

    public List<Cell> xmlToEntities(List<CellXmlResponse> list, Lane lane) {
        if (list == null || list.isEmpty()) return new ArrayList<>();
        List<Cell> out = new ArrayList<>(list.size());
        for (CellXmlResponse dto : list) {
            out.add(xmlToEntity(dto, lane));
        }
        return out;
    }

    public CellResponse entityToResponse(Cell entity) {
        if (entity == null) return null;
        CellResponse dto = new CellResponse();
        dto.setId(entity.getId());
        dto.setLength(entity.getLength());
        dto.setOffset(entity.getOffset());
        return dto;
    }

    public CellXmlResponse toDto(Cell entity) {
        if (entity == null) return null;
        CellXmlResponse dto = new CellXmlResponse();
        dto.setId(entity.getId());
        dto.setLength(entity.getLength());
        dto.setOffset(entity.getOffset());
        return dto;
    }

    public List<CellXmlResponse> toDtos(List<Cell> entities) {
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
