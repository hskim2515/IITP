package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.station.StationEntity;
import com.iitp.iitp_rest.repository.StationRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class StationService {

    private final StationRepository stationRepository;

    public void saveStation(StationEntity entity) {
        stationRepository.save(entity);
    }

    public List<StationEntity> getAllStations() {
        return stationRepository.findAll();
    }

    public StationEntity getStation(Long id) {
        return stationRepository.findById(id).orElse(new StationEntity());
    }

    @Transactional
    public void saveBusStation(StationEntity entity, Long id) {
        if (entity.getId() == null) {
            // 새로 생성(create)
            stationRepository.save(entity);
        } else {
            // 수정(update): 존재 여부 확인
            StationEntity existing = stationRepository.findById(entity.getId())
                    .orElseThrow(() -> new EntityNotFoundException("Station not found: " + entity.getId()));
            existing.setName(entity.getName());
            existing.setGeojson(entity.getGeojson());
            stationRepository.save(existing);
        }
    }
}
