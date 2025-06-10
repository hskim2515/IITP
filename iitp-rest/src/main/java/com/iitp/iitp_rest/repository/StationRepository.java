package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.publicTransit.station.StationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface StationRepository extends JpaRepository<StationEntity, Long> {
    List<StationEntity> findAll();  // 모든 정류장 데이터를 조회
}
