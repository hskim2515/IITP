package com.iitp.iitp_rest.service.network;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

/**
 * osm_turn_restriction(OsmTurnRestrictionImporter로 적재) 조회 — KtdbNetworkConverter/
 * KtdbStreamingConverter가 connection 후보를 필터링할 때 쓴다.
 *
 * <p>기존 ktdb_turninfo 조회 패턴(변환 시작 시 전체를 한 번에 읽어 메모리에서 조회, 후보마다
 * DB 왕복하지 않음)과 동일하게, {@link #loadAll()}로 전체(전국 기준 약 2.7만건, 수 MB) 를
 * 한 번만 로드해 변환기가 자체적으로 매칭하도록 한다.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class OsmTurnRestrictionRepository {

    /** no_* 계열만 다룬다 — only_* 는 "지정된 회전 외 전부 금지"라는 더 강한 의미라 자동
     *  필터링에 쓰면 잘못 매칭 시 유효한 다른 회전까지 지울 위험이 커서 제외한다. */
    public record Restriction(long id, String restriction, double viaLat, double viaLon,
                               Double fromBearing, Double toBearing) {
        public boolean isProhibition() { return restriction != null && restriction.startsWith("no_"); }
    }

    private final JdbcTemplate jdbc;

    public boolean hasData() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM osm_turn_restriction_import_meta", Long.class);
        return count != null && count > 0;
    }

    public List<Restriction> loadAll() {
        List<Restriction> result = jdbc.query(
                "SELECT id, restriction, via_lat, via_lon, from_bearing, to_bearing FROM osm_turn_restriction " +
                        "WHERE from_bearing IS NOT NULL AND to_bearing IS NOT NULL AND restriction LIKE 'no_%'",
                (rs, rowNum) -> new Restriction(
                        rs.getLong("id"), rs.getString("restriction"),
                        rs.getDouble("via_lat"), rs.getDouble("via_lon"),
                        (Double) rs.getObject("from_bearing"), (Double) rs.getObject("to_bearing")));
        log.info("[OsmTurnRestrictionRepository] 회전제약 {}건 로드", result.size());
        return result;
    }
}
