package com.iitp.iitp_rest.model.layer;

import com.fasterxml.jackson.annotation.JsonBackReference;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

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

    @Column(name = "form_type", nullable = false)
    private String formType;

    @Column(name = "url", nullable = false)
    private String url;
}
