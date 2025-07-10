package com.iitp.iitp_rest.model.pavementMarking;

import com.iitp.iitp_rest.model.BaseLogs;
import com.iitp.iitp_rest.model.LogsData;
import com.vladmihalcea.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import lombok.experimental.SuperBuilder;
import org.hibernate.annotations.Type;

@Entity
@Table(name = "pavement_marking_logs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@SuperBuilder
@ToString
public class PavementMarkingLogs extends BaseLogs {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private LogsData data;
}
