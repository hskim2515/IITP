package com.iitp.iitp_rest.model.vehicle;

import com.iitp.iitp_rest.model.geometry.Cartesian3;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "vehicle_type_parameter")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class VehicleTypeParameter {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "vehicle_type_id")
    private VehicleType vehicleType;

    private String parameterName;
    private String mean;
    private String sd;
    private String min;
    private String max;
    private String dist;
}

