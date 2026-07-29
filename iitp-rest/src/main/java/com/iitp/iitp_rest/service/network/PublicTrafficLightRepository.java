package com.iitp.iitp_rest.service.network;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Slf4j
@Repository
@RequiredArgsConstructor
public class PublicTrafficLightRepository {

    public record Signal(long id, double lat, double lon) {}

    private final JdbcTemplate jdbc;
    private NamedParameterJdbcTemplate namedJdbc;

    private NamedParameterJdbcTemplate named() {
        if (namedJdbc == null) namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        return namedJdbc;
    }

    public boolean hasData() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM public_traffic_light_import_meta", Long.class);
        return count != null && count > 0;
    }

    /** bbox 내 신호등 조회 — GET /network/public-traffic-lights 용(OSM 버전과 동일 패턴). */
    public List<Signal> findInBbox(double south, double west, double north, double east) {
        return named().query(
                "SELECT id, lat, lon FROM public_traffic_light " +
                        "WHERE geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)",
                new MapSqlParameterSource()
                        .addValue("west", west).addValue("south", south)
                        .addValue("east", east).addValue("north", north),
                (rs, rowNum) -> new Signal(rs.getLong("id"), rs.getDouble("lat"), rs.getDouble("lon")));
    }

    /** 전국 신호등 전체 로드 — DummySignalGenerator가 변환 1회당 한 번만 로드해 메모리에서
     *  매칭한다(OsmTrafficSignalRepository와 동일 관례). */
    public List<Signal> loadAll() {
        List<Signal> result = jdbc.query(
                "SELECT id, lat, lon FROM public_traffic_light",
                (rs, rowNum) -> new Signal(rs.getLong("id"), rs.getDouble("lat"), rs.getDouble("lon")));
        log.info("[PublicTrafficLightRepository] 신호등 {}건 로드", result.size());
        return result;
    }
}
