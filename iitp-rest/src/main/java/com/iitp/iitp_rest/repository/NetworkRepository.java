package com.iitp.iitp_rest.repository;

import com.iitp.iitp_rest.model.network.Network;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NetworkRepository extends JpaRepository<Network, Long> {

    List<Network> findAll();  // 모든 네트워크 데이터를 조회
}