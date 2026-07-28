package com.iitp.iitp_rest.model.vehicle.type;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "vehicle_type")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class VehicleType {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String vehicleId;
    private String name;
    private String v2x;
    private String drt;

    @Column(name = "max_pax")
    private String maxPax;

    /** NextSim vehicletypes.xml 차종이 VehicleInfo.veh_type/차량명 접두사로 실제 내보내는
     *  축약 코드(쉼표로 여러 개 가능, 예: "NV,AV"). VehicleController가 vehicle_sim.db의
     *  차종 코드를 이 차종(vehicleId)으로 해석할 때 사용 — "교통수단 유형" 편집 화면에서
     *  직접 관리한다(하드코딩 대신 DB 기반). */
    @Column(name = "nextsim_type_code")
    private String nextsimTypeCode;

}

