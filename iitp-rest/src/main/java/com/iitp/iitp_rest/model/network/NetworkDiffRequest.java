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
    /**
     * diff 를 적용할 기준 네트워크의 versionId (옵션).
     * "새 버전으로 저장" 시 대상 versionId 에는 아직 network.xml 이 없으므로,
     * 기준 버전(현재 편집 중이던 버전)에서 로드해 diff 적용 후 대상으로 저장한다.
     * null 이면 대상 versionId 자체가 기준 (기존 버전에 덮어 저장).
     */
    private String baseVersionId;

    private List<LinkResponse> upsertLinks = new ArrayList<>();
    private List<NodeResponse> upsertNodes = new ArrayList<>();
    private List<Long> deleteLinkIds = new ArrayList<>();
    private List<Long> deleteNodeIds = new ArrayList<>();
}
