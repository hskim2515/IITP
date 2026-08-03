package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 버스/철도 노선(PT Line) ↔ 네트워크(링크/노드)/정류장 참조 검증.
 *
 * <p>{@code BusPtLinesXml.LineXml}은 {@code <link seq="...">}/{@code <node seq="...">}/
 * {@code <station seq="...">}/{@code <garage seq="...">} 4개의 id 시퀀스를 동시에 참조한다.
 * KTDB 재임포트는 링크/노드 id를 전면 교체하므로(odmatrix.xml/signal.xml과 동일한 문제),
 * 재임포트 후 기존 노선이 새 네트워크와 안 맞을 수 있는데 지금까지 이를 검증하는 코드
 * 자체가 없었다 — {@code BusPtLineService}/{@code RailPtLineService}는 순수 SFTP CRUD.
 *
 * <p>정류장(station)/차고지(garage) id는 KTDB 재임포트로 바뀌지 않는 별도 네임스페이스라
 * (OSM 임포트로만 생성, KTDB는 정류장 자체를 만들지 않음) 이 검증 대상에서 제외한다 —
 * 노선이 정말 깨지는 건 재임포트로 통째 바뀌는 link/node seq 쪽이다.
 *
 * <p>signal.xml/odmatrix.xml 검증({@code NextSimInputScaffolder})과 동일하게 "참조가
 * 없으면(빈 파일 등) 유효"로 본다 — 대조 불가능한 상태를 무효로 잘못 판정하지 않기 위함.
 */
public final class PtLineValidation {

    private PtLineValidation() {}

    private static final Pattern BUS_SEQ = Pattern.compile("<(link|node)\\s+seq=\"([^\"]*)\"");
    private static final Pattern RAIL_STATION_SEQ = Pattern.compile("railStationSeq=\"([^\"]*)\"");

    /** roadPTline(.xml) 컨텐츠의 link/node seq가 전부 새 네트워크에 존재하는지 검증. */
    public static boolean busRouteValid(String linesXmlContent, Set<String> validLinkIds, Set<String> validNodeIds) {
        if (linesXmlContent == null || linesXmlContent.isBlank()) return true;
        Matcher m = BUS_SEQ.matcher(linesXmlContent);
        while (m.find()) {
            String kind = m.group(1);
            String seq = m.group(2);
            if (seq == null || seq.isBlank()) continue;
            Set<String> validSet = "link".equals(kind) ? validLinkIds : validNodeIds;
            if (validSet == null) continue; // 대조 불가 — 보수적으로 통과
            for (String id : seq.trim().split("\\s+")) {
                if (!validSet.contains(id)) return false;
            }
        }
        return true;
    }

    /** railPTLine(.xml) 컨텐츠의 railStationSeq가 전부 현재 정류장 집합에 존재하는지 검증. */
    public static boolean railRouteValid(String routesXmlContent, Set<String> validStationIds) {
        if (routesXmlContent == null || routesXmlContent.isBlank()) return true;
        if (validStationIds == null) return true; // 대조 불가 — 보수적으로 통과
        Matcher m = RAIL_STATION_SEQ.matcher(routesXmlContent);
        while (m.find()) {
            String seq = m.group(1);
            if (seq == null || seq.isBlank()) continue;
            for (String id : seq.trim().split("\\s+")) {
                if (!validStationIds.contains(id)) return false;
            }
        }
        return true;
    }

    /**
     * link/node seq가 비어있는(null 또는 공백) Line을 찾는다 — NextSim RouteGenerator는 이
     * 필드가 비어있으면 터미널 조합과 무관하게 항상 "basic_string::_M_construct null not
     * valid"로 크래시한다(실측: 이 앱이 기대하는 평평한 {@code <link seq="..">} 스키마가
     * 아니라 {@code <links><link id=".." station=".."/></links>} 형태의 중첩 스키마로 된
     * 외부 원본 roadPTline.xml을 "그대로" 파일 임포트했을 때, JAXB가 매핑되는 요소를 못
     * 찾아 link/node/station이 전부 null로 파싱됨 — 부천 원본 데이터로 재현). station.seq가
     * 비어있는 경우(정류장이 하나도 안 걸린 노선)도 별개의 확인된 SIGSEGV 크래시 원인이라
     * 함께 걸러낸다(OsmFacilityConverter.convertBusRoutes가 생성 시점에 이미 제외하는
     * 조건과 동일 — 이 검증은 그 안전장치를 안 거치는 수동 업로드/직접 편집 경로를 막는다).
     *
     * @return 문제가 있는 Line id 목록(문제 없으면 빈 리스트)
     */
    public static List<String> findBusLinesMissingRouting(BusPtLinesXml xml) {
        List<String> bad = new ArrayList<>();
        if (xml == null || xml.getLines() == null) return bad;
        for (var line : xml.getLines()) {
            boolean linkMissing = line.getLink() == null || isBlank(line.getLink().getSeq());
            boolean nodeMissing = line.getNode() == null || isBlank(line.getNode().getSeq());
            boolean stationMissing = line.getStation() == null || isBlank(line.getStation().getSeq());
            if (linkMissing || nodeMissing || stationMissing) {
                bad.add(line.getId() != null ? line.getId() : "(id 없음)");
            }
        }
        return bad;
    }

    /**
     * link/node/station seq가 비어있는 Line을 걸러내 xml에서 제거하고, 제거된 id 목록을
     * 반환한다. 예전엔 이런 Line이 하나라도 있으면 파일 전체의 저장/가져오기를 거부했으나
     * (findBusLinesMissingRouting 도입 근거였던 "NextSim이 반드시 크래시한다" 주장), 실측
     * 결과(2026-08-03) 이런 라인이 있어도 NextSim은 크래시 없이 그 라인만 건너뛰고 정상
     * 완료하는 것으로 확인됐다 — 그렇다고 경로 정보가 없어 쓸모없는 라인을 그대로 저장할
     * 이유는 없으므로, 전체 거부 대신 문제 라인만 제외하고 나머지는 정상 저장한다.
     */
    public static List<String> dropBusLinesMissingRouting(BusPtLinesXml xml) {
        List<String> removed = new ArrayList<>();
        if (xml == null || xml.getLines() == null) return removed;
        List<BusPtLinesXml.LineXml> kept = new ArrayList<>();
        for (var line : xml.getLines()) {
            boolean linkMissing = line.getLink() == null || isBlank(line.getLink().getSeq());
            boolean nodeMissing = line.getNode() == null || isBlank(line.getNode().getSeq());
            boolean stationMissing = line.getStation() == null || isBlank(line.getStation().getSeq());
            if (linkMissing || nodeMissing || stationMissing) {
                removed.add(line.getId() != null ? line.getId() : "(id 없음)");
            } else {
                kept.add(line);
            }
        }
        xml.setLines(kept);
        return removed;
    }

    /** railStationSeq가 비어있는(null 또는 공백) route를 찾는다 — bus 쪽과 동일한 이유로
     *  NextSim이 터미널 조합과 무관하게 크래시하는 원인이 될 수 있어 저장 전에 걸러낸다. */
    public static List<String> findRailRoutesMissingStationSeq(RailPtLineXml xml) {
        List<String> bad = new ArrayList<>();
        if (xml == null || xml.getRoutes() == null) return bad;
        for (var route : xml.getRoutes()) {
            if (isBlank(route.getRailStationSeq())) {
                bad.add(route.getId() != null ? String.valueOf(route.getId()) : (route.getName() != null ? route.getName() : "(id 없음)"));
            }
        }
        return bad;
    }

    /** railStationSeq가 비어있는 route를 걸러내 xml에서 제거하고, 제거된 id 목록을 반환한다
     *  — dropBusLinesMissingRouting과 동일 이유로 전체 거부 대신 문제 route만 제외한다. */
    public static List<String> dropRailRoutesMissingStationSeq(RailPtLineXml xml) {
        List<String> removed = new ArrayList<>();
        if (xml == null || xml.getRoutes() == null) return removed;
        var kept = new ArrayList<>(xml.getRoutes());
        kept.removeIf(route -> {
            boolean missing = isBlank(route.getRailStationSeq());
            if (missing) removed.add(route.getId() != null ? String.valueOf(route.getId()) : (route.getName() != null ? route.getName() : "(id 없음)"));
            return missing;
        });
        xml.setRoutes(kept);
        return removed;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
