package com.iitp.iitp_rest.model.threedtiles;

import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "threed_tileset_url")
@Getter
@Setter
public class ThreedTilesetUrl {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tileset_id", nullable = false)
    @JsonBackReference
    private ThreedTileset tileset;

    @Column(nullable = false, length = 1024)
    private String url;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;
}
