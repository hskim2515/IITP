package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NetworkResponse {
    private List<NodeResponse> nodes = new ArrayList<>();
    private List<LinkResponse> links = new ArrayList<>();
    /** 2점 캘리브레이션 축척 배율(NetworkXml.baseScale 미러) — 타일 빌드 시 width 보정에 필요 */
    private Double baseScale;
}
