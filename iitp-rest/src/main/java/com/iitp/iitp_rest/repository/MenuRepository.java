package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.menu.Menu;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface MenuRepository extends JpaRepository<Menu, Long> {

    @EntityGraph(attributePaths = {"parents"})
    List<Menu> findAll();

    @EntityGraph(attributePaths = {"parents"})
    Optional<Menu> findByMenuIdOrderBySortOrder(Long menuId);

    @EntityGraph(attributePaths = {"parents"})
    Optional<Menu> findByMenuCode(String menuCode);

    @EntityGraph(attributePaths = {"parents"})
    @Query("SELECT m FROM Menu m WHERE m.menuCode = :menuCode AND m.available = 'Y'")
    Optional<Menu> findByMenuCodeAndAvailable(String menuCode);

    @EntityGraph(attributePaths = {"parents"})
    @Query("SELECT m FROM Menu m WHERE m.depth = :depth AND m.available = 'Y' ORDER BY m.sortOrder")
    List<Menu> findAllByDepthAndAvailableOrderBySortOrder(@Param("depth") Integer depth);

    @EntityGraph(attributePaths = {"parents"})
    @Query("SELECT m FROM Menu m WHERE m.available = 'Y' ORDER BY m.sortOrder")
    List<Menu> findAllByAvailableOrderBySortOrder();
}
