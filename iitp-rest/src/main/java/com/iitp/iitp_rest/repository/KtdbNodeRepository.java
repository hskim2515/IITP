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

    /**
     * bbox 내 링크(f_node 또는 t_node가 bbox 안에 있는 링크)에 속한 모든 노드를 반환.
     * findByNodeIdIn 대신 사용 — 파라미터 수 무제한.
     */
    @org.springframework.data.jpa.repository.Query(value = """
        SELECT DISTINCT n.* FROM ktdb_node n
        WHERE n.node_id IN (
            SELECT l.f_node FROM ktdb_link l
            WHERE l.f_node IN (
                SELECT node_id FROM ktdb_node
                WHERE lon BETWEEN :west AND :east AND lat BETWEEN :south AND :north
            ) OR l.t_node IN (
                SELECT node_id FROM ktdb_node
                WHERE lon BETWEEN :west AND :east AND lat BETWEEN :south AND :north
            )
            UNION
            SELECT l.t_node FROM ktdb_link l
            WHERE l.f_node IN (
                SELECT node_id FROM ktdb_node
                WHERE lon BETWEEN :west AND :east AND lat BETWEEN :south AND :north
            ) OR l.t_node IN (
                SELECT node_id FROM ktdb_node
                WHERE lon BETWEEN :west AND :east AND lat BETWEEN :south AND :north
            )
        )
        """, nativeQuery = true)
    List<KtdbNode> findNodesForBboxLinks(
        @org.springframework.data.repository.query.Param("west")  double west,
        @org.springframework.data.repository.query.Param("east")  double east,
        @org.springframework.data.repository.query.Param("south") double south,
        @org.springframework.data.repository.query.Param("north") double north
    );
}
