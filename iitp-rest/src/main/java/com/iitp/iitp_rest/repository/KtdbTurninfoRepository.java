package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.ktdb.KtdbTurninfo;
import com.iitp.iitp_rest.model.ktdb.KtdbTurninfoPk;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface KtdbTurninfoRepository extends JpaRepository<KtdbTurninfo, KtdbTurninfoPk> {

    @Query("SELECT t FROM KtdbTurninfo t WHERE t.id.nodeId IN :nodeIds")
    List<KtdbTurninfo> findByNodeIds(@Param("nodeIds") Collection<String> nodeIds);
}
