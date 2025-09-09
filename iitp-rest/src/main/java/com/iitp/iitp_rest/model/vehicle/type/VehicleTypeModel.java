package com.iitp.iitp_rest.model.vehicle.type;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "vehicle_type_model")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class VehicleTypeModel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private String color;
    private String fileName;
    private String filePath;
    private String length;
}

