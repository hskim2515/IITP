package com.iitp.iitp_rest.service;

import com.iitp.iitp_rest.model.threedtiles.*;
import com.iitp.iitp_rest.repository.ThreedTilesetRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Service
@RequiredArgsConstructor
public class ThreedTilesetService {

    private final ThreedTilesetRepository repository;

    @Transactional(readOnly = true)
    public List<ThreedTilesetResponse> getAll() {
        return repository.findAllByOrderBySortOrderAsc().stream()
                .map(this::toResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public ThreedTilesetResponse create(ThreedTilesetRequest req) {
        ThreedTileset entity = new ThreedTileset();
        entity.setLabel(req.getLabel());
        entity.setSortOrder(req.getSortOrder());
        applyUrls(entity, req.getUrls());
        return toResponse(repository.save(entity));
    }

    @Transactional
    public ThreedTilesetResponse update(Long id, ThreedTilesetRequest req) {
        ThreedTileset entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("3D Tileset not found: " + id));
        entity.setLabel(req.getLabel());
        entity.setSortOrder(req.getSortOrder());
        entity.getUrls().clear();
        applyUrls(entity, req.getUrls());
        return toResponse(repository.save(entity));
    }

    @Transactional
    public void delete(Long id) {
        repository.deleteById(id);
    }

    private void applyUrls(ThreedTileset entity, List<String> urls) {
        if (urls == null) return;
        IntStream.range(0, urls.size()).forEach(i -> {
            ThreedTilesetUrl u = new ThreedTilesetUrl();
            u.setTileset(entity);
            u.setUrl(urls.get(i));
            u.setSortOrder(i);
            entity.getUrls().add(u);
        });
    }

    private ThreedTilesetResponse toResponse(ThreedTileset e) {
        ThreedTilesetResponse r = new ThreedTilesetResponse();
        r.setId(e.getId());
        r.setLabel(e.getLabel());
        r.setSortOrder(e.getSortOrder());
        r.setUrls(e.getUrls().stream().map(ThreedTilesetUrl::getUrl).collect(Collectors.toList()));
        return r;
    }
}
