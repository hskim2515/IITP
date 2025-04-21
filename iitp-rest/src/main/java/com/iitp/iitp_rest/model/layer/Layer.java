package com.iitp.iitp_rest.model.layer;

// Layer.java
import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Entity
@Table(name = "layer")
@Getter
@Setter
public class Layer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    @JsonBackReference // 순환 참조 방지
    private LayerGroup group;

    @Column(name = "key", nullable = false)
    private String key;

    @Column(name = "label", nullable = false)
    private String label;

    @Column(name = "basic", nullable = false)
    private boolean basic = false;

    @Column(name = "auth", nullable = false)
    private int auth = 0;
}
