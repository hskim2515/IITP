package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.Network;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface NetworkRepository extends JpaRepository<Network, Long> {
    @Override
    @EntityGraph(attributePaths = {"nodes", "links"})
    List<Network> findAll();

    @EntityGraph(attributePaths = {"nodes", "links"})
    Optional<Network> findById(Long id);

    @EntityGraph(attributePaths = {"nodes", "links"})
    @Query("select n.id from Network n where n.name = :key")
    Optional<Long> findIdByName(String key);
}