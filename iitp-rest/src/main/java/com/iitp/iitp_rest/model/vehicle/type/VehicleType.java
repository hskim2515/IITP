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

}

