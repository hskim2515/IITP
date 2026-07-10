package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeModel;
import com.iitp.iitp_rest.repository.VehicleTypeModelRepository;
import com.iitp.iitp_rest.util.FileStorageService;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/vehicle-models")
public class VehicleTypeModelController {

    private final VehicleTypeModelRepository vehicleTypeModelRepository;
    private final FileStorageService fileStorage;

    public VehicleTypeModelController(VehicleTypeModelRepository vehicleTypeModelRepository, FileStorageService fileStorage) {
        this.vehicleTypeModelRepository = vehicleTypeModelRepository;
        this.fileStorage = fileStorage;
    }

    @GetMapping
    public ResponseEntity<List<VehicleTypeModel>> getAllVehicleTypeModel() {
        return ResponseEntity.ok(vehicleTypeModelRepository.findAll(Sort.by(Sort.Direction.ASC, "id")));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getVehicleTypeFlat(@PathVariable Long id) {
        return ResponseEntity.ok(vehicleTypeModelRepository.findById(id));
    }

    @PostMapping
    public ResponseEntity<?> createVehicleModel(
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "vehicleTypeId", required = false) Long vehicleTypeId,
            @RequestParam(value = "color", required = false) String color,
            @RequestParam(value = "length", required = false) String length,
            @RequestParam(value = "correctionHpr", required = false) String correctionHpr,
            @RequestParam(value = "zOffset", required = false) Double zOffset,
            @RequestPart(value = "file", required = false) MultipartFile file) {
        try {
            VehicleTypeModel model = new VehicleTypeModel();
            model.setName(name);
            model.setVehicleTypeId(vehicleTypeId);
            model.setColor(color);
            model.setLength(length);
            model.setCorrectionHpr(correctionHpr);
            model.setZOffset(zOffset);
            if (file != null && !file.isEmpty()) {
                fileStorage.uploadFile(file.getInputStream(), file.getOriginalFilename());
                model.setFileName(file.getOriginalFilename());
                model.setFilePath("/models/" + file.getOriginalFilename());
            }
            return ResponseEntity.ok(vehicleTypeModelRepository.save(model));
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("파일 업로드 중 오류 발생");
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<VehicleTypeModel> updateVehicleTypeModel(
            @PathVariable Long id,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "vehicleTypeId", required = false) Long vehicleTypeId,
            @RequestParam(value = "color", required = false) String color,
            @RequestParam(value = "length", required = false) String length,
            @RequestParam(value = "correctionHpr", required = false) String correctionHpr,
            @RequestParam(value = "zOffset", required = false) Double zOffset,
            @RequestPart(value = "file", required = false) MultipartFile file) throws IOException {
        try {
            Optional<VehicleTypeModel> existingOpt = vehicleTypeModelRepository.findById(id);
            if (existingOpt.isEmpty()) return ResponseEntity.notFound().build();
            VehicleTypeModel existing = existingOpt.get();
            existing.setName(name);
            existing.setVehicleTypeId(vehicleTypeId);
            existing.setColor(color);
            existing.setLength(length);
            existing.setCorrectionHpr(correctionHpr);
            existing.setZOffset(zOffset);
            if (file != null && !file.isEmpty()) {
                String oldPath = existing.getFilePath();
                if (oldPath != null && !oldPath.isEmpty()) {
                    try { fileStorage.deleteFile(oldPath); }
                    catch (IOException e) { System.err.println("파일 삭제 실패: " + oldPath); }
                }
                String fileName = file.getOriginalFilename();
                fileStorage.uploadFile(file.getInputStream(), fileName);
                existing.setFileName(fileName);
                existing.setFilePath("/models/" + fileName);
            }
            return ResponseEntity.ok(vehicleTypeModelRepository.save(existing));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/delete")
    public ResponseEntity<?> deleteVehicleTypeModels(@RequestBody List<Long> ids) {
        List<VehicleTypeModel> modelsToDelete = vehicleTypeModelRepository.findAllById(ids);
        for (VehicleTypeModel model : modelsToDelete) {
            String filePath = model.getFilePath();
            if (filePath != null && !filePath.isEmpty()) {
                try { fileStorage.deleteFile(filePath); }
                catch (IOException e) { System.err.println("파일 삭제 실패: " + filePath); }
            }
        }
        vehicleTypeModelRepository.deleteAllById(ids);
        return ResponseEntity.ok().build();
    }
}
