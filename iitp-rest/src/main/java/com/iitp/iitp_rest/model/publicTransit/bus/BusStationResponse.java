package com.iitp.iitp_rest.model.publicTransit.bus;

import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import lombok.Data;

@Data
public class BusStationResponse {
    private String id;

    private TransitMode transitMode;

    private Long linkRef;

    private Long laneRef;

    private Double offset;

    private StationType type;

    private Integer parkingLots;

    private String address;

    private String center;

    /** OSM 중앙버스전용차로(highway=busway 등) 신호로 스냅됐으면 true — laneRef는 NextSim
     *  호환을 위해 그 링크의 실제 차선 중 하나(0)를 가리키지만, 실제 물리적 위치는 그 링크
     *  자체가 아니라 상하행 링크 사이(중앙분리대)이므로 프론트 렌더링에서만 참고한다.
     *  NextSim이 소비하는 roadStation.xml({@link BusStationXml})에는 매핑하지 않는다. */
    private Boolean medianLane;

    private BusLineResponse line;
}
