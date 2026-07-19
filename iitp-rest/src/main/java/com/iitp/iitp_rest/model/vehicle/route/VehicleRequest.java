package com.iitp.iitp_rest.model.vehicle.route;

import com.iitp.iitp_rest.model.network.road.RoadResponse;
import lombok.Data;


@Data
public class VehicleRequest {
    private int numVehicle;
    private RoadResponse roadEntities;
    private int speedFactor;
    /** true이면 캐시된 vehicle_sim.db와 CZML을 삭제하고 처음부터 재생성 */
    private boolean regenerate;
    /** true일 때만 vehicle_sim.db 부재 시 더미 차량을 생성한다 (명시적 생성 버튼 전용).
     *  false(기본)면 원본이 없을 때 더미를 만들지 않고 404/실패로 응답한다. */
    private boolean generateDummy;

    // ── viewport+시간창 스트리밍 (POST /vehicle-route/{key}/viewport 전용, additive) ──
    /** "west,south,east,north" (WGS84). 이 영역과 교차한 차량만 반환 */
    private String bbox;
    /** 시간창 시작/끝 (시뮬레이션 시작 기준 초). 둘 다 null 이면 전체 시간 */
    private Integer fromTime;
    private Integer toTime;
    /** 시간창 양쪽 버퍼 초 (보간 연속성, 기본 60) */
    private Integer bufferSec;
}
