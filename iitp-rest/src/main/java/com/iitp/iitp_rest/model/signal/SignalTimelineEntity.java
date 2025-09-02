package com.iitp.iitp_rest.model.signal;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Data
@Table(name = "signal_timeline")
public class SignalTimelineEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "version_id")
    private String versionId;

    @Column(name = "target_id")
    private String targetId;

    @Column(columnDefinition = "text")
    private String signalTimelines;

    @Column(name = "insert_date")
    private LocalDateTime insertDate = LocalDateTime.now();
}


