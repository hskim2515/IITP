package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.vehicle.type.VehicleType;
import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeParameter;
import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeParameterDTO;
import com.iitp.iitp_rest.repository.VehicleTypeParameterRepository;
import com.iitp.iitp_rest.repository.VehicleTypeRepository;
import jakarta.transaction.Transactional;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/vehicle-types")
public class VehicleTypeController {

    private final VehicleTypeRepository vehicleTypeRepository;
    private final VehicleTypeParameterRepository vehicleTypeParameterRepository;

    public VehicleTypeController(VehicleTypeRepository vehicleTypeRepository, VehicleTypeParameterRepository vehicleTypeParameterRepository) {
        this.vehicleTypeRepository = vehicleTypeRepository;
        this.vehicleTypeParameterRepository = vehicleTypeParameterRepository;
    }

    @GetMapping
    public ResponseEntity<List<VehicleType>> getAllVehicleTypes() {
        return ResponseEntity.ok(vehicleTypeRepository.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getVehicleTypeFlat(@PathVariable Long id) {
        Optional<VehicleType> vehicleTypeOpt = vehicleTypeRepository.findById(id);
        if (vehicleTypeOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        VehicleType vehicleType = vehicleTypeOpt.get();
        List<VehicleTypeParameter> parameters = vehicleTypeParameterRepository.findByVehicleType_Id(id);

        List<VehicleTypeParameterDTO> flatList = parameters.stream()
                .map(p -> new VehicleTypeParameterDTO(
                        vehicleType.getVehicleId(),
                        vehicleType.getName(),
                        vehicleType.getV2x(),
                        vehicleType.getDrt(),
                        vehicleType.getMaxPax(),
                        p.getId(),
                        p.getParameterName(),
                        p.getMean(),
                        p.getSd(),
                        p.getMin(),
                        p.getMax(),
                        p.getDist()
                ))
                .collect(Collectors.toList());

        return ResponseEntity.ok(flatList);
    }

    @PostMapping
    @Transactional
    public ResponseEntity<?> createVehicleTypeWithParameters(@RequestBody Map<String, Object> rawData) {

        String vehicleId = (String) rawData.get("vehicleId");
        String name = (String) rawData.get("name");
        String v2x = (String) rawData.get("v2x");
        String drt = (String) rawData.get("drt");
        String maxPax = (String) rawData.get("maxPax");

        VehicleType vehicleType = new VehicleType();
        vehicleType.setVehicleId(vehicleId);
        vehicleType.setName(name);
        vehicleType.setV2x(v2x);
        vehicleType.setDrt(drt);
        vehicleType.setMaxPax(maxPax);

        VehicleType savedVehicleType = vehicleTypeRepository.save(vehicleType);

        rawData.forEach((key, value) -> {
            if (List.of("vehicleId", "name", "v2x", "drt", "maxPax").contains(key)) {
                return;
            }

            Map<String, String> paramMap = (Map<String, String>) value;

            VehicleTypeParameter param = new VehicleTypeParameter();
            param.setVehicleType(savedVehicleType);
            param.setParameterName(key);
            param.setMean(paramMap.getOrDefault("mean", ""));
            param.setSd(paramMap.getOrDefault("sd", ""));
            param.setMin(paramMap.getOrDefault("min", ""));
            param.setMax(paramMap.getOrDefault("max", ""));
            param.setDist(paramMap.getOrDefault("dist", ""));

            vehicleTypeParameterRepository.save(param);
        });

        return ResponseEntity.ok("등록이 완료되었습니다.");
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> updateVehicleTypeParameter(
            @PathVariable Long id,
            @RequestBody Map<String, Object> updatedData) {

        Optional<VehicleType> vehicleTypeOpt = vehicleTypeRepository.findById(id);
        if (vehicleTypeOpt.isEmpty()) {
            return ResponseEntity.badRequest().body("해당 Id에 해당하는 차량 타입이 존재하지 않습니다.");
        }

        VehicleType vehicleType = vehicleTypeOpt.get();
        vehicleType.setVehicleId((String) updatedData.get("vehicleId"));
        vehicleType.setName((String) updatedData.get("name"));
        vehicleType.setV2x((String) updatedData.get("v2x"));
        vehicleType.setDrt((String) updatedData.get("drt"));
        vehicleType.setMaxPax((String) updatedData.get("maxPax"));
        vehicleTypeRepository.save(vehicleType);

        vehicleTypeParameterRepository.deleteByVehicleType(vehicleType);

        updatedData.forEach((key, value) -> {
            if (List.of("vehicleId", "name", "v2x", "drt", "maxPax").contains(key)) return;
            if (!(value instanceof Map)) return;

            Map<String, String> paramMap = (Map<String, String>) value;

            VehicleTypeParameter param = new VehicleTypeParameter();
            param.setVehicleType(vehicleType);
            param.setParameterName(key);
            param.setMean(paramMap.getOrDefault("mean", ""));
            param.setSd(paramMap.getOrDefault("sd", ""));
            param.setMin(paramMap.getOrDefault("min", ""));
            param.setMax(paramMap.getOrDefault("max", ""));
            param.setDist(paramMap.getOrDefault("dist", ""));

            vehicleTypeParameterRepository.save(param);
        });

        return ResponseEntity.ok("수정이 완료되었습니다.");
    }

    @Transactional
    @PostMapping("/delete")
    public ResponseEntity<?> deleteVehicleTypeParameters(@RequestBody List<Long> ids) {
        vehicleTypeParameterRepository.deleteByVehicleTypeIds(ids);
        vehicleTypeRepository.deleteAllById(ids);
        return ResponseEntity.ok().build();
    }

}