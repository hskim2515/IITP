package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.model.vehicle.type.VehicleTypeModel;
import com.iitp.iitp_rest.repository.VehicleTypeModelRepository;
import com.iitp.iitp_rest.util.SftpFileManager;
import com.jcraft.jsch.JSchException;
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
    private final SftpFileManager sftpFileManager;

    public VehicleTypeModelController(VehicleTypeModelRepository vehicleTypeModelRepository, SftpFileManager sftpFileManager) {
        this.vehicleTypeModelRepository = vehicleTypeModelRepository;
        this.sftpFileManager = sftpFileManager;
    }

    @GetMapping
    public ResponseEntity<List<VehicleTypeModel>> getAllVehicleTypeModel() {
        List<VehicleTypeModel> sortedList = vehicleTypeModelRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));
        return ResponseEntity.ok(sortedList);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getVehicleTypeFlat(@PathVariable Long id) {

        Optional<VehicleTypeModel> vehicleTypeOpt = vehicleTypeModelRepository.findById(id);

        return ResponseEntity.ok(vehicleTypeOpt);
    }

    @PostMapping
    public ResponseEntity<?> createVehicleModel(
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "vehicleTypeId", required = false) Long vehicleTypeId,
            @RequestParam(value = "color", required = false) String color,
            @RequestParam(value = "length", required = false) String length,
            @RequestParam(value = "correctionHpr", required = false) String correctionHpr,
            @RequestParam(value = "zOffset", required = false) Double zOffset,
            @RequestPart(value = "file", required = false) MultipartFile file
    ) {
        try {
            VehicleTypeModel model = new VehicleTypeModel();
            model.setName(name);
            model.setVehicleTypeId(vehicleTypeId);
            model.setColor(color);
            model.setLength(length);
            model.setCorrectionHpr(correctionHpr);
            model.setZOffset(zOffset);

            String filePath = "/models/";

            if (file != null && !file.isEmpty()) {
                sftpFileManager.uploadFile(file.getInputStream(), file.getOriginalFilename());
                model.setFileName(file.getOriginalFilename());
                model.setFilePath(filePath+ file.getOriginalFilename());
            }

            VehicleTypeModel saved = vehicleTypeModelRepository.save(model);
            return ResponseEntity.ok(saved);

        } catch (IOException e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("파일 업로드 중 오류 발생");
        } catch (JSchException e) {
            throw new RuntimeException(e);
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
            @RequestPart(value = "file", required = false) MultipartFile file) throws IOException, JSchException {

        try {
            Optional<VehicleTypeModel> existingOpt = vehicleTypeModelRepository.findById(id);
            if (existingOpt.isEmpty()) {
                return ResponseEntity.notFound().build();
            }

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
                    try {
                        sftpFileManager.deleteFile(oldPath);
                    } catch (IOException | JSchException e) {
                        System.err.println("파일 삭제 실패: " + oldPath);
                    }
                }
                String filePath = "/models/";
                String fileName = file.getOriginalFilename();
                sftpFileManager.uploadFile(file.getInputStream(), fileName);
                existing.setFileName(fileName);
                existing.setFilePath(filePath + fileName);
            }

            VehicleTypeModel saved = vehicleTypeModelRepository.save(existing);

            return ResponseEntity.ok(saved);
        }catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/delete")
    public ResponseEntity<?> deleteVehicleTypeModels(@RequestBody List<Long> ids) {
        List<VehicleTypeModel> modelsToDelete = vehicleTypeModelRepository.findAllById(ids);

        for (VehicleTypeModel model : modelsToDelete) {
            String filePath = model.getFilePath();
            if (filePath != null && !filePath.isEmpty()) {
                try {
                    sftpFileManager.deleteFile(filePath);
                } catch (IOException | JSchException e) {
                    System.err.println("파일 삭제 실패: " + filePath);
                }
            }
        }

        vehicleTypeModelRepository.deleteAllById(ids);

        return ResponseEntity.ok().build();
    }
}