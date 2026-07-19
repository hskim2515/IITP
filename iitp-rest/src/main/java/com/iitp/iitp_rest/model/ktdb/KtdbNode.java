package com.iitp.iitp_rest.model.ktdb;

import jakarta.persistence.*;
import lombok.Getter;

@Getter
@Entity
@Table(name = "ktdb_node")
public class KtdbNode {

    @Id
    @Column(name = "node_id", length = 20)
    private String nodeId;

    @Column(nullable = false)
    private double lon;

    @Column(nullable = false)
    private double lat;

    /** 노드유형 코드 (101 평면교차로, 103 램프분기, 104 도로시종점 등). 구버전 DB 호환 위해 nullable */
    @Column(name = "node_type", length = 3)
    private String nodeType;

    /** 교차로 명칭 (예: "서구청네거리") */
    @Column(name = "node_name", length = 50)
    private String nodeName;

    /** 회전제한(TURNINFO) 존재 플래그: "1"이면 존재 */
    @Column(name = "turn_p", length = 1)
    private String turnP;
}
