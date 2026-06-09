package com.iitp.iitp_rest.model.ktdb;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.EqualsAndHashCode;
import lombok.Getter;

import java.io.Serializable;

@Getter
@EqualsAndHashCode
@Embeddable
public class KtdbTurninfoPk implements Serializable {

    @Column(name = "node_id", length = 20)
    private String nodeId;

    @Column(name = "st_link", length = 20)
    private String stLink;

    @Column(name = "ed_link", length = 20)
    private String edLink;
}
