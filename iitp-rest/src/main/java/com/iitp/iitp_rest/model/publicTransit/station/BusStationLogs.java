package com.iitp.iitp_rest.model.publicTransit.station;

import com.iitp.iitp_rest.model.BaseLogs;
import com.vladmihalcea.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import lombok.experimental.SuperBuilder;
import org.hibernate.annotations.Type;

import java.util.Map;

@Entity
@Table(name = "bus_station_logs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@SuperBuilder
public class BusStationLogs extends BaseLogs {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

}
