package com.iitp.iitp_rest.service.vehicle;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitp.iitp_rest.model.VehicleRoute;
import com.iitp.iitp_rest.repository.VehicleRouteRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class VehicleRouteService {

    @Autowired
    private VehicleRouteRepository repository;

    public Optional<VehicleRoute> getByVersionId(String versionId) {
        return repository.findByVersionId(versionId);
    }

    public VehicleRoute saveRoute(String versionId, Object czml, Object features, Object positions) throws JsonProcessingException, JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();

        VehicleRoute route = new VehicleRoute();
        route.setVersionId(versionId);
        route.setCzml(mapper.writeValueAsString(czml));
        route.setFeatures(mapper.writeValueAsString(features));
        route.setPositions(mapper.writeValueAsString(positions));

        return repository.save(route);
    }
}

