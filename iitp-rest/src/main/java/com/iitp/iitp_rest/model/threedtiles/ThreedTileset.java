package com.iitp.iitp_rest.model.threedtiles;

import com.fasterxml.jackson.annotation.JsonManagedReference;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "threed_tileset")
@Getter
@Setter
public class ThreedTileset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String label;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @JsonManagedReference
    @OneToMany(mappedBy = "tileset", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("sortOrder ASC")
    private List<ThreedTilesetUrl> urls = new ArrayList<>();
}
