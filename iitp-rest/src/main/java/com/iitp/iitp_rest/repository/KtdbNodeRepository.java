package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.ktdb.KtdbNode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface KtdbNodeRepository extends JpaRepository<KtdbNode, String> {

    List<KtdbNode> findByNodeIdIn(Collection<String> nodeIds);

    @org.springframework.data.jpa.repository.Query(
        "SELECT n FROM KtdbNode n WHERE n.lon BETWEEN :west AND :east AND n.lat BETWEEN :south AND :north")
    List<KtdbNode> findByBbox(
        @org.springframework.data.repository.query.Param("west")  double west,
        @org.springframework.data.repository.query.Param("east")  double east,
        @org.springframework.data.repository.query.Param("south") double south,
        @org.springframework.data.repository.query.Param("north") double north
    );
}
