package com.iitp.iitp_rest.service.network;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * CrossRoadInfoImporter가 적재한 crossroad_info 조회 — OsmTrafficSignalRepository/
 * PublicTrafficLightRepository와 동일 패턴. ⚠️ 커버리지가 좁아(서울 전역 398건, 주간선도로급만)
 * 게이팅(생성 차단) 용도가 아니라 "여기는 확실히 신호교차로다"라는 참고/시각화용으로만 쓴다
 * (crossroad_info_migration.sql 배경 참고).
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class CrossRoadInfoRepository {

    public record CrossRoad(long id, String name, double lat, double lon) {}

    private final JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate namedJdbc;

    private NamedParameterJdbcTemplate named() {
        if (namedJdbc == null) namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        return namedJdbc;
    }

    public boolean hasData() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM crossroad_info_import_meta", Long.class);
        return count != null && count > 0;
    }

    /** bbox 내 교차로 조회 — GET /network/crossroad-info 용. */
    public List<CrossRoad> findInBbox(double south, double west, double north, double east) {
        return named().query(
                "SELECT id, int_nm, lat, lon FROM crossroad_info " +
                        "WHERE geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                new MapSqlParameterSource()
                        .addValue("west", west).addValue("south", south)
                        .addValue("east", east).addValue("north", north),
                (rs, rowNum) -> new CrossRoad(rs.getLong("id"), rs.getString("int_nm"),
                        rs.getDouble("lat"), rs.getDouble("lon")));
    }

    public List<CrossRoad> loadAll() {
        List<CrossRoad> result = jdbc.query(
                "SELECT id, int_nm, lat, lon FROM crossroad_info",
                (rs, rowNum) -> new CrossRoad(rs.getLong("id"), rs.getString("int_nm"),
                        rs.getDouble("lat"), rs.getDouble("lon")));
        log.info("[CrossRoadInfoRepository] 교차로 {}건 로드", result.size());
        return result;
    }
}
