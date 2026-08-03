package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlElement;
import jakarta.xml.bind.annotation.XmlElementWrapper;
import jakarta.xml.bind.annotation.XmlRootElement;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 외부(NextSim 배포판 bucheon 예시 등) roadPTline.xml/railPTline.xml이 이 앱의 평평한 스키마가
 * 아니라 중첩 스키마로 돼 있을 때, 이 앱 스키마로 변환한다.
 *
 * <p>실측 확인된 문제(2026-08-03): 이 앱의 {@link BusPtLinesXml.LineXml}/{@link
 * RailPtLineXml.RouteXml}은 각각 {@code <Line><link seq=".."/><node seq=".."/>
 * <station seq=".."/><garage seq=".."/></Line>}, {@code <route railStationSeq=".."/>} 형태의
 * "평평한(공백구분 id 목록)" 스키마를 기대하는데, NextSim 배포판이 실제로 쓰는 예시
 * 데이터셋(network_xml_bucheon)은 {@code <Line><links><link id=".." station=".."/></links>
 * </Line>}(버스), {@code <Mode><Lines><Line><stationSeq id=".." seq=".."/></Line></Lines>
 * </Mode>}(철도)처럼 완전히 다른 중첩 구조다. 이 파일을 그대로 JAXB로 파싱하면 link/node/
 * station(버스)이나 routes 자체(철도, 래퍼 요소명부터 다름)가 전부 null/빈 값이 되어, 파일
 * 임포트가 HTTP 200으로 "성공"해도 실제로는 노선이 0개 저장되는 조용한 실패로 이어졌다
 * (PtLineValidation의 "경로 정보 없는 라인 드롭" 로직이 "전부 드롭"되는 것까지는 잡지만,
 * 그 자체를 고쳐주지는 못한다 — 이 클래스가 그 실제 복구를 담당).
 */
@Slf4j
@Component
public class PtLineNestedSchemaConverter {

    // ── 버스: <Lines mode="Bus"><Line id fee interval><links><link id seq station use_ptlane/></links></Line></Lines> ──

    @XmlRootElement(name = "Lines")
    @XmlAccessorType(XmlAccessType.NONE)
    static class NestedBusLinesXml {
        @XmlElement(name = "Line")
        private List<NestedBusLineXml> lines;
    }

    @XmlAccessorType(XmlAccessType.NONE)
    static class NestedBusLineXml {
        @XmlAttribute private String id;
        @XmlAttribute private Integer interval;
        @XmlElementWrapper(name = "links")
        @XmlElement(name = "link")
        private List<NestedBusLinkXml> links;
    }

    @XmlAccessorType(XmlAccessType.NONE)
    static class NestedBusLinkXml {
        @XmlAttribute private Long id;
        @XmlAttribute private Integer seq;
        @XmlAttribute private String station;
    }

    /**
     * @param xmlBytes 업로드된 원본 파일 바이트(재사용을 위해 InputStream이 아니라 byte[]로 받음)
     * @param network  node.seq를 유도하는 데 필요한, 이 versionId에 이미 저장된 network.xml
     *                 (링크 id 네임스페이스가 이 파일과 일치해야 함 — 같은 배포판 데이터셋이면
     *                 항상 일치한다). null이면 변환을 시도하지 않는다(node.seq를 만들 수 없어
     *                 어차피 dropBusLinesMissingRouting에서 다시 걸러지므로 무의미).
     * @return 변환 결과(1개 이상의 라인이 실제로 만들어진 경우만). 중첩 스키마가 아니거나
     *         (예: <links> 래퍼 자체가 없음) 변환할 게 없으면 null — 호출부는 이 경우 원래
     *         파싱 결과(보통 전부 드롭됨)를 그대로 쓴다.
     */
    public BusPtLinesXml tryConvertBus(byte[] xmlBytes, NetworkXml network) {
        if (network == null || network.getLinks() == null) return null;
        NestedBusLinesXml nested;
        try {
            JAXBContext ctx = JAXBContext.newInstance(NestedBusLinesXml.class);
            nested = (NestedBusLinesXml) ctx.createUnmarshaller().unmarshal(new ByteArrayInputStream(xmlBytes));
        } catch (Exception e) {
            log.debug("[PtLineNestedSchemaConverter] 버스 중첩 스키마 파싱 실패(중첩 스키마 아님으로 간주): {}", e.getMessage());
            return null;
        }
        if (nested.lines == null || nested.lines.isEmpty()) return null;
        boolean anyHasLinks = nested.lines.stream().anyMatch(l -> l.links != null && !l.links.isEmpty());
        if (!anyHasLinks) return null;

        Map<Long, LinkXml> linkById = new HashMap<>();
        for (LinkXml l : network.getLinks()) {
            if (l.getId() != null) linkById.put(l.getId(), l);
        }

        List<BusPtLinesXml.LineXml> converted = new ArrayList<>();
        for (NestedBusLineXml nl : nested.lines) {
            if (nl.links == null || nl.links.isEmpty()) continue;
            List<NestedBusLinkXml> sorted = new ArrayList<>(nl.links);
            sorted.sort(Comparator.comparing(l -> l.seq != null ? l.seq : 0));

            List<String> linkIds = new ArrayList<>();
            List<String> stationIds = new ArrayList<>();
            List<String> nodeIds = new ArrayList<>();
            boolean nodeSeqComplete = true;
            for (NestedBusLinkXml lk : sorted) {
                if (lk.id == null) continue;
                linkIds.add(String.valueOf(lk.id));
                if (lk.station != null && !lk.station.isBlank()) stationIds.add(lk.station.trim());
                LinkXml matched = linkById.get(lk.id);
                if (matched == null || matched.getFromNode() == null || matched.getToNode() == null) {
                    nodeSeqComplete = false;
                    continue;
                }
                // 첫 링크는 from_node부터, 이후는 각 링크의 to_node만 이어붙인다(연속 링크는
                // 이전 링크의 to_node == 다음 링크의 from_node라 실측으로 확인됨 — 위상 연속).
                if (nodeIds.isEmpty()) nodeIds.add(String.valueOf(matched.getFromNode()));
                nodeIds.add(String.valueOf(matched.getToNode()));
            }
            if (linkIds.isEmpty()) continue;

            BusPtLinesXml.LineXml line = new BusPtLinesXml.LineXml();
            line.setId(nl.id);
            line.setInterval(nl.interval);
            line.setLink(seqXml(String.join(" ", linkIds)));
            if (nodeSeqComplete && !nodeIds.isEmpty()) line.setNode(seqXml(String.join(" ", nodeIds)));
            line.setStation(seqXml(String.join(" ", stationIds)));
            line.setGarage(seqXml(""));
            converted.add(line);
        }
        if (converted.isEmpty()) return null;

        BusPtLinesXml result = new BusPtLinesXml();
        result.setLines(converted);
        return result;
    }

    private static BusPtLinesXml.SeqXml seqXml(String seq) {
        BusPtLinesXml.SeqXml x = new BusPtLinesXml.SeqXml();
        x.setSeq(seq);
        return x;
    }

    // ── 철도: <Mode type=".."><Lines><Line id fee departureTime><stationSeq id seq timeOffset/></Line></Lines></Mode> ──

    @XmlRootElement(name = "Mode")
    @XmlAccessorType(XmlAccessType.NONE)
    static class NestedRailModeXml {
        @XmlAttribute private String type;
        @XmlElementWrapper(name = "Lines")
        @XmlElement(name = "Line")
        private List<NestedRailLineXml> lines;
    }

    @XmlAccessorType(XmlAccessType.NONE)
    static class NestedRailLineXml {
        @XmlAttribute private String id;
        @XmlAttribute private String fee;
        @XmlAttribute private String departureTime;
        @XmlElement(name = "stationSeq")
        private List<NestedStationSeqXml> stationSeqs;
    }

    @XmlAccessorType(XmlAccessType.NONE)
    static class NestedStationSeqXml {
        @XmlAttribute private String id;
        @XmlAttribute private Integer seq;
        @XmlAttribute private String timeOffset;
    }

    /**
     * 철도는 버스와 달리 network.xml이 필요 없다 — 원본에 정류장 id 순서(stationSeq)가 이미
     * 명시돼 있어 별도 유도가 필요 없다. 다만 원본 노선 id가 "1_up"처럼 문자열인데 이 앱의
     * {@link RailPtLineXml.RouteXml#id}는 Integer라 그대로 못 옮긴다 — 순번을 새로 매기고
     * 원본 id는 {@code name} 필드에 보존한다(정보 손실 없이 스키마 제약만 회피).
     *
     * @return 변환 결과. 중첩 스키마가 아니거나(stationSeq 자체가 없음) 변환할 게 없으면 null.
     */
    public RailPtLineXml tryConvertRail(byte[] xmlBytes) {
        NestedRailModeXml nested;
        try {
            JAXBContext ctx = JAXBContext.newInstance(NestedRailModeXml.class);
            nested = (NestedRailModeXml) ctx.createUnmarshaller().unmarshal(new ByteArrayInputStream(xmlBytes));
        } catch (Exception e) {
            log.debug("[PtLineNestedSchemaConverter] 철도 중첩 스키마 파싱 실패(중첩 스키마 아님으로 간주): {}", e.getMessage());
            return null;
        }
        if (nested.lines == null || nested.lines.isEmpty()) return null;
        boolean anyHasStationSeq = nested.lines.stream().anyMatch(l -> l.stationSeqs != null && !l.stationSeqs.isEmpty());
        if (!anyHasStationSeq) return null;

        List<RailPtLineXml.RouteXml> converted = new ArrayList<>();
        int idSeq = 1;
        for (NestedRailLineXml nl : nested.lines) {
            if (nl.stationSeqs == null || nl.stationSeqs.isEmpty()) continue;
            List<NestedStationSeqXml> sorted = new ArrayList<>(nl.stationSeqs);
            sorted.sort(Comparator.comparing(s -> s.seq != null ? s.seq : 0));

            List<String> stationIds = new ArrayList<>();
            List<String> timeOffsets = new ArrayList<>();
            for (NestedStationSeqXml s : sorted) {
                if (s.id == null) continue;
                stationIds.add(s.id);
                timeOffsets.add(s.timeOffset != null ? s.timeOffset : "0");
            }
            if (stationIds.isEmpty()) continue;

            RailPtLineXml.RouteXml route = new RailPtLineXml.RouteXml();
            route.setId(idSeq++);
            route.setName(nl.id); // 원본 문자열 id 보존
            route.setFee(nl.fee);
            route.setDepartureTime(nl.departureTime);
            route.setRailStationSeq(String.join(" ", stationIds));
            route.setTimeOffsetSeq(String.join(" ", timeOffsets));
            converted.add(route);
        }
        if (converted.isEmpty()) return null;

        RailPtLineXml result = new RailPtLineXml();
        result.setType(nested.type);
        result.setRoutes(converted);
        return result;
    }
}
