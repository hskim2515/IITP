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

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<Map<String, Double>> coords;
}
