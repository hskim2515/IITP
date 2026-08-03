package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.BaseVersion;
import com.iitp.iitp_rest.model.publicTransit.bus.BusStationVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface BusStationVersionsRepository extends JpaRepository<BusStationVersion, Long> {

//    @Query("SELECT p.feature FROM PavementMarkingUpdate p WHERE p.versionId = :versionId")
//    List<String> findFeaturesByVersionId(@Param("versionId") Long versionId);

    /** ⚠️ version_role 미지정 — DB에 uq_bus_station_version_role(version_id, version_role)
     *  제약이 없던 과거에 ORIGIN/LATEST 두 행이 실제로 쌓인 적이 있어(2026-08-03 실측,
     *  database/bus_rail_signal_versions_constraint_fix.sql 참고) 이 메서드를 호출하면
     *  IncorrectResultSizeDataAccessException으로 죽을 수 있다. 새 코드는 반드시
     *  {@link #findByVersionIdAndVersionRole}을 쓸 것 — 이 메서드는 기존 호출부 호환용으로만 남긴다. */
    Optional<BusStationVersion> findByVersionId(String versionId);

    Optional<BusStationVersion> findByVersionIdAndVersionRole(String versionId, BaseVersion.VersionRole versionRole);

    void deleteByVersionId(String versionId);
}

