package com.iitp.iitp_rest.service.pavementMarking;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.network.cell.CellXml;
import com.iitp.iitp_rest.model.network.lane.LaneXml;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.pavementMarking.PavementMarkingData;
import com.iitp.iitp_rest.service.network.NetworkJaxbParser;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.FileStorageService;
import com.iitp.iitp_rest.util.LaneGeometryUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 노면표시(linkRef/laneRef/cellId/offset)로부터 실제 위경도(lat/lng)+angle을 계산해 채운다.
 *
 * <p>노면표시 자동생성(generateDummyPavementMarkings, 프론트)은 linkRef/laneRef/cellId/offset만
 * 만들고 좌표는 null로 남겨둔 채 저장한다 — 렌더링 시점에 그 순간 로드된 차선 지오메트리에서
 * 매번 다시 계산하는 구조였다. 그런데 차선 상세 데이터는 2D 지도가 'detail' LOD(최대 근접
 * 줌)일 때만 로드되고(NETWORK_TILING.USE_MVT_2D 상시 켜짐 — 일반 줌에서는 도로가 MVT로만
 * 그려짐), 좌표가 null인 레코드는 {@link PavementMarkingTileService}의 SQLite RTree 인덱싱에서
 * 아예 제외된다 — 그 결과 저장 직후(isChanged 리셋 이후)엔 타일 조회가 항상 0건이라 노면표시가
 * 줌 레벨과 무관하게 영원히 안 보이는 문제가 있었다(실측). 다른 시설물(버스정류장/철도역 등)
 * 처럼 저장 시점에 실제 좌표를 한 번 계산해 영속시켜, 화면/줌 레벨과 무관하게 항상 표시되게
 * 한다.
 */
@Slf4j
@RequiredArgsConstructor
@org.springframework.stereotype.Component
public class PavementMarkingCoordinateResolver {

    // CoordinateUtils 내부 상수와 동일 — 로컬 shape 좌표(미터 근사)를 WGS84로 변환하는 데 쓰는
    // 프로젝트 전역 관례값(private이라 여기서 동일 값을 별도로 둔다 — OsmFacilityConverter 등
    // 프론트/백엔드 여러 곳에 이미 동일하게 중복돼 있는 상수).
    private static final double SCALE_X = 1.0 / 88000.0;
    private static final double SCALE_Y = 1.0 / 111000.0;

    private final FileStorageService fileStorage;
    private final NetworkJaxbParser networkJaxbParser;

    /**
     * markings 중 좌표가 비어있는 항목만 linkRef/laneRef/cellId/offset 기준으로 좌표+angle을
     * 계산해 채운다. 이미 좌표가 있는 항목(수동 배치 등)은 건드리지 않는다. network.xml을 못
     * 찾거나 파싱에 실패해도 예외를 던지지 않는다 — 노면표시 저장 자체는 항상 성공해야 하고,
     * 좌표 계산 실패는 "다음 저장 때 다시 시도"로 자연 복구된다(이 메서드는 매 저장마다 호출됨).
     */
    public void resolveCoordinates(String versionId, List<PavementMarkingData> markings) {
        if (markings == null || markings.isEmpty()) return;
        if (markings.stream().noneMatch(PavementMarkingCoordinateResolver::isMissingCoordinate)) return;

        NetworkXml network;
        try {
            byte[] xmlBytes = fileStorage.readFile(versionId + "/network.xml");
            network = networkJaxbParser.parse(new ByteArrayInputStream(xmlBytes));
        } catch (Exception e) {
            log.warn("[PavementMarkingCoordinateResolver] network.xml 로드/파싱 실패, 좌표 계산 건너뜀: versionId={}, {}",
                    versionId, e.getMessage());
            return;
        }
        if (network.getBaseLat() == null || network.getBaseLon() == null || network.getLinks() == null) return;
        double baseLat = network.getBaseLat();
        double baseLon = network.getBaseLon();
        double rotationRad = network.getBaseRotation() != null ? Math.toRadians(network.getBaseRotation()) : 0.0;
        double scale = network.getBaseScale() != null ? network.getBaseScale() : 1.0;

        Map<Long, LinkXml> linkMap = new HashMap<>();
        for (LinkXml link : network.getLinks()) {
            if (link.getId() != null) linkMap.put(link.getId(), link);
        }

        int resolved = 0, failed = 0;
        for (PavementMarkingData m : markings) {
            if (!isMissingCoordinate(m)) continue;
            if (!resolveOne(m, linkMap, baseLat, baseLon, rotationRad, scale)) failed++;
            else resolved++;
        }
        log.info("[PavementMarkingCoordinateResolver] versionId={} 좌표 계산 완료: {}건 성공, {}건 실패(링크/차선/셀 참조 무효)",
                versionId, resolved, failed);
    }

    private boolean resolveOne(PavementMarkingData m, Map<Long, LinkXml> linkMap,
                                double baseLat, double baseLon, double rotationRad, double scale) {
        if (m.getLinkRef() == null || m.getLaneRef() == null || m.getCellId() == null || m.getOffset() == null) return false;

        LinkXml link = linkMap.get(m.getLinkRef().longValue());
        if (link == null || link.getLanes() == null || m.getLaneRef() < 0 || m.getLaneRef() >= link.getLanes().size()) return false;
        LaneXml lane = link.getLanes().get(m.getLaneRef());

        List<CellXml> cells = lane.getCells();
        if (cells == null || m.getCellId() < 0 || m.getCellId() >= cells.size()) return false;

        double totalOffset = 0;
        for (int i = 0; i < m.getCellId(); i++) totalOffset += cells.get(i).getLength();
        totalOffset += m.getOffset();

        // ⚠️ lane.shape를 그대로 쓰면 안 된다 — 실측: network.xml에서 한 링크의 모든 차선이
        // lane.shape="링크 shape와 완전히 동일한 값"으로 저장돼 있어(차선별 오프셋이 전혀
        // 반영 안 됨), 이걸 그대로 쓰면 같은 링크의 모든 차선 마킹이 링크 중앙 한 점에 겹쳐
        // 찍힌다(2D에서 "여러 lane이 가운데에 모여 표시" 로 실제 재현됨). 프론트의 기존 폴백
        // (interpolateByOffset.ts의 computeLaneCenterlineOl)도 같은 이유로 lane.shape를 안 믿고
        // link.shape + width + laneIdx로 직접 차선 중심선을 계산한다 — 이 앱 전체에서 차선
        // 지오메트리는 원래 이렇게 유도되는 게 정상 관례(lane.shape XML 필드 자체가 신뢰
        // 불가능한 값). 동일 알고리즘을 {@link LaneGeometryUtils}로 공유(VehicleController의
        // geometry 투영 로직도 동일 유틸을 사용).
        List<Coordinates> localPts = LaneGeometryUtils.computeLaneCenterline(link, m.getLaneRef());
        if (localPts == null || localPts.size() < 2) return false;

        double[] pointAndAngle = LaneGeometryUtils.pointAndAngleAtOffset(localPts, totalOffset);
        if (pointAndAngle == null) return false;

        Coordinates wgs = CoordinateUtils.transformCoordinates(
                baseLon, baseLat, pointAndAngle[0], pointAndAngle[1], SCALE_X, SCALE_Y, rotationRad, scale);

        PavementMarkingData.Coordinates c = new PavementMarkingData.Coordinates();
        c.setLat(wgs.getLat());
        c.setLng(wgs.getLng());
        m.setCoordinates(List.of(c));
        m.setAngle(pointAndAngle[2] + rotationRad);
        return true;
    }

    private static boolean isMissingCoordinate(PavementMarkingData m) {
        List<PavementMarkingData.Coordinates> coords = m.getCoordinates();
        if (coords == null || coords.isEmpty() || coords.get(0) == null) return true;
        return coords.get(0).getLat() == null || coords.get(0).getLng() == null;
    }
}
