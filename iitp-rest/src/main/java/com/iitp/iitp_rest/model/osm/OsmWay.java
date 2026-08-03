package com.iitp.iitp_rest.model.osm;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class OsmWay {
    private long id;
    private List<Long> nodeIds;
    private Map<String, String> tags;

    public String getTag(String key) {
        return tags != null ? tags.get(key) : null;
    }

    /** oneway=yes/true/1 또는 motorway 계열은 단방향 (정방향만) */
    public boolean isOneway() {
        String val = getTag("oneway");
        if ("yes".equals(val) || "true".equals(val) || "1".equals(val)) return true;
        String hw = getTag("highway");
        return "motorway".equals(hw) || "motorway_link".equals(hw);
    }

    /** oneway=-1 또는 reverse → 역방향만 */
    public boolean isReverseOneway() {
        String val = getTag("oneway");
        return "-1".equals(val) || "reverse".equals(val);
    }

    /** 버스전용차로 위치. LEFT/RIGHT는 way 노드 순서(시작→끝) 기준 상대 방향 —
     *  이 way를 역방향으로 순회하는 링크에 적용할 땐 좌우를 뒤집어야 한다. */
    public enum BusLaneSide { LEFT, RIGHT, BOTH, DEDICATED, NONE }

    /**
     * OSM 버스전용차로 관련 태그를 해석한다.
     * - highway=busway 또는 access=no + psv/bus=yes|designated: 도로 전체가 버스 전용
     *   (한국 중앙버스전용차로처럼 물리적으로 분리된 별도 way로 매핑되는 경우가 흔함).
     * - busway(:right/:left/:both)=lane: 도로 안의 특정 차선이 버스 전용.
     * - bus:lanes=no|no|designated (또는 psv:lanes, way 진행방향 기준 왼→오 순서 페어 태그):
     *   "designated"/"yes"가 배열 앞쪽이면 LEFT, 뒤쪽이면 RIGHT로 근사.
     * - lanes:bus/lanes:psv=N (방향 태그 없이 개수만): 한국은 커브(우측) 버스전용차로가
     *   압도적으로 흔하므로(중앙차로는 대부분 highway=busway로 별도 way 처리됨) RIGHT로 근사.
     */
    public BusLaneSide busLaneSide() {
        String highway = getTag("highway");
        if ("busway".equals(highway)) return BusLaneSide.DEDICATED;

        String access = getTag("access");
        String psv = getTag("psv");
        String bus = getTag("bus");
        if ("no".equals(access) && (isDesignatedOrYes(psv) || isDesignatedOrYes(bus))) {
            return BusLaneSide.DEDICATED;
        }

        String busway = getTag("busway");
        boolean bothSided = "lane".equals(busway) || "opposite_lane".equals(busway)
                || "lane".equals(getTag("busway:both"));
        boolean right = "lane".equals(getTag("busway:right"));
        boolean left  = "lane".equals(getTag("busway:left"));
        if (bothSided || (right && left)) return BusLaneSide.BOTH;
        if (right) return BusLaneSide.RIGHT;
        if (left)  return BusLaneSide.LEFT;

        String laneTags = getTag("bus:lanes");
        if (laneTags == null) laneTags = getTag("psv:lanes");
        if (laneTags != null) {
            String[] parts = laneTags.split("\\|");
            for (int i = 0; i < parts.length; i++) {
                if (isDesignatedOrYes(parts[i].trim())) {
                    return i < parts.length / 2.0 ? BusLaneSide.LEFT : BusLaneSide.RIGHT;
                }
            }
        }

        if (getTag("lanes:bus") != null || getTag("lanes:psv") != null) return BusLaneSide.RIGHT;

        return BusLaneSide.NONE;
    }

    private static boolean isDesignatedOrYes(String v) {
        return "designated".equals(v) || "yes".equals(v);
    }

    /**
     * 버스전용차로 태그(side)를 실제 차선 배열 인덱스로 변환한다. 차선 인덱스 규약은
     * 프론트(computeLaneCenterlineOl/Cesium)와 동일하게 0=최좌측(중앙선 쪽), numLanes-1=
     * 최우측(커브 쪽)이다. RIGHT/LEFT는 OSM way 원본 노드 순서 기준이므로, 이 way를
     * 역방향으로 순회하는 링크/엣지라면 좌우를 뒤집어야 실제 주행 방향 기준 올바른 차선이
     * 된다(reversedFromWay=true).
     * <p>BOTH(예: busway:both=lane)는 "상하행 각자 자기 커브 쪽에 버스전용차로가 있다"는
     * 뜻이지 상하행이 공유하는 중앙차로가 아니다 — 그래서 RIGHT와 동일하게 이 링크(방향)
     * 자신의 커브로 처리한다. 반면 DEDICATED(highway=busway처럼 물리적으로 분리된 전용
     * way)는 실제로 상하행 사이(또는 그 자체가 유일한 공유 차로)일 수 있어 이 링크
     * 혼자만의 차선 배열로는 표현이 안 될 수 있다.
     * @return 신호 없음(NONE)이거나 DEDICATED(중앙차로)면 null — 단일 인덱스로 표현할 수
     *         없다는 뜻이며, 호출부가 반대방향 링크와의 중간점 계산 등 별도 처리를 해야
     *         한다({@link com.iitp.iitp_rest.service.network.OsmFacilityConverter}). 다만
     *         DEDICATED는 실전에서 거의 항상 numLanes&lt;=1인 별도 way라 위의 조기 반환으로
     *         이미 처리되고, 이 분기까지 오는 경우는 드물다.
     */
    public static Integer laneIndexForSide(BusLaneSide side, int numLanes, boolean reversedFromWay) {
        if (numLanes <= 1) return 0;
        return switch (side) {
            case RIGHT, BOTH -> reversedFromWay ? 0 : numLanes - 1;
            case LEFT  -> reversedFromWay ? numLanes - 1 : 0;
            case DEDICATED, NONE -> null;
        };
    }
}
