package com.iitp.iitp_rest.model.ktdb;

import com.vladmihalcea.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.Getter;
import org.hibernate.annotations.Type;

import java.util.List;
import java.util.Map;

@Getter
@Entity
@Table(name = "ktdb_link")
public class KtdbLink {

    @Id
    @Column(name = "link_id", length = 20)
    private String linkId;

    @Column(name = "f_node", nullable = false, length = 20)
    private String fNode;

    @Column(name = "t_node", nullable = false, length = 20)
    private String tNode;

    @Column(nullable = false)
    private int lanes;

    @Column(name = "road_rank", nullable = false)
    private int roadRank;

    @Column(name = "road_name", length = 100)
    private String roadName;

    @Column(name = "max_spd", nullable = false)
    private int maxSpd;

    @Column
    private Double length;

    @Column(name = "mid_lon", nullable = false)
    private double midLon;

    @Column(name = "mid_lat", nullable = false)
    private double midLat;

    // ── 원본 SHP 보존 속성 (구버전 DB 호환 위해 모두 nullable) ──

    /** 도로유형: 000 일반, 001 고가차도, 002 지하차도, 003 교량, 004 터널 */
    @Column(name = "road_type", length = 3)
    private String roadType;

    /** 노선번호 (예: 국도 "0001") */
    @Column(name = "road_no", length = 5)
    private String roadNo;

    /** 연결로(램프) 구분: "0" 일반, 그 외 IC/JC 연결로 */
    @Column(name = "connect", length = 3)
    private String connect;

    /** 도로사용여부: "0" 사용, "1" 미사용(공사중 등) */
    @Column(name = "road_use", length = 1)
    private String roadUse;

    /** 중용구간 여부: "1"이면 ktdb_multilink에 노선정보 존재 */
    @Column(name = "multi_link", length = 1)
    private String multiLink;

    /** 통행제한차량 코드 ("0" 없음) */
    @Column(name = "rest_veh", length = 3)
    private String restVeh;

    /** 통과제한폭(m), 0=제한없음 */
    @Column(name = "rest_w")
    private Integer restW;

    /** 통과제한높이(m), 0=제한없음 */
    @Column(name = "rest_h")
    private Integer restH;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<Map<String, Double>> coords;
}
