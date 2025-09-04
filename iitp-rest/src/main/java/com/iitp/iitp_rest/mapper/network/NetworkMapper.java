package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import com.iitp.iitp_rest.model.network.NetworkTreeResponse;
import com.iitp.iitp_rest.model.network.NetworkXmlResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class NetworkMapper {

    private final NodeMapper nodeMapper;
    private final LinkMapper linkMapper;

    public Network xmlToEntity(NetworkXmlResponse dto) {
        return Network.builder()
                .name(String.valueOf(dto.getId()))
                .build();
    }

    public NetworkResponse entityToResponse(Network entity) {
        if (entity == null) return null;
        NetworkResponse dto = new NetworkResponse();
        dto.setId(entity.getId());
        dto.setName(entity.getName());
        return dto;
    }

    public NetworkTreeResponse entityToTreeResponse(Network entity) {
        if (entity == null) return null;
        NetworkTreeResponse dto = new NetworkTreeResponse();
        dto.setId(entity.getId());
        dto.setName(entity.getName());
        return dto;
    }

    public NetworkXmlResponse toDto(Network entity) {
        if (entity == null) return null;
        NetworkXmlResponse dto = new NetworkXmlResponse();
        dto.setId(entity.getId());
//        dto.setName(entity.getName());

        // 자식 DTO로 변환하면서 부모(dto)를 전달하여 양방향 관계 설정
        dto.setNodes(nodeMapper.toDtos(entity.getNodes()));
        dto.setLinks(linkMapper.toDtos(entity.getLinks()));
        return dto;
    }
}
