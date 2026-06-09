package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.ktdb.KtdbLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface KtdbLinkRepository extends JpaRepository<KtdbLink, String> {

    /** f_node 또는 t_node가 bbox 안에 있는 링크 — 경계 링크까지 포함 */
    @Query(value = """
        SELECT DISTINCT l.* FROM ktdb_link l
        WHERE l.f_node IN (
            SELECT node_id FROM ktdb_node
            WHERE lon BETWEEN :west AND :east AND lat BETWEEN :south AND :north
        ) OR l.t_node IN (
            SELECT node_id FROM ktdb_node
            WHERE lon BETWEEN :west AND :east AND lat BETWEEN :south AND :north
        )
        """, nativeQuery = true)
    List<KtdbLink> findByBbox(
            @Param("west")  double west,
            @Param("east")  double east,
            @Param("south") double south,
            @Param("north") double north
    );
}
