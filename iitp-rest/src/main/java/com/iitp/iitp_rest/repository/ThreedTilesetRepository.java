package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.threedtiles.ThreedTileset;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ThreedTilesetRepository extends JpaRepository<ThreedTileset, Long> {
    List<ThreedTileset> findAllByOrderBySortOrderAsc();
}
