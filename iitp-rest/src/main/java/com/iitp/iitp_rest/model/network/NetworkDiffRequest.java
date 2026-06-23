package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 도메인 id 기반 네트워크 부분 저장 요청 (단계 4-1).
 *
 * <p>전체 네트워크 대신 변경분(추가/수정 = upsert, 삭제 = id 목록)만 담는다.
 * 서버는 현재 네트워크에 id 기준으로 적용한다.
 */
@Data
public class NetworkDiffRequest {
    private List<LinkResponse> upsertLinks = new ArrayList<>();
    private List<NodeResponse> upsertNodes = new ArrayList<>();
    private List<Long> deleteLinkIds = new ArrayList<>();
    private List<Long> deleteNodeIds = new ArrayList<>();
}
