package com.iitp.iitp_rest.mapper.network;

import com.iitp.iitp_rest.model.network.Network;
import com.iitp.iitp_rest.model.network.NetworkResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class NetworkMapper {

    private final NodeMapper nodeMapper;
    private final LinkMapper linkMapper;

    public Network toEntity(NetworkResponse dto) {
        return Network.builder()
                .name(dto.getName())
                .build();
    }

    public NetworkResponse toDto(Network entity) {
        if (entity == null) return null;
        NetworkResponse dto = new NetworkResponse();
        dto.setId(entity.getId());
        dto.setName(entity.getName());

        // 자식 DTO로 변환하면서 부모(dto)를 전달하여 양방향 관계 설정
        dto.setNodes(nodeMapper.toDtos(entity.getNodes()));
        dto.setLinks(linkMapper.toDtos(entity.getLinks()));
        return dto;
    }
}
