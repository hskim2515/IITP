package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.util.CoordinateUtils;
import com.iitp.iitp_rest.util.RemoteXmlFetch;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkService {

    private final NetworkJaxbParser networkJaxbParser;
    private final ScenarioRepository scenarioRepository;
    private final ScenarioVersionRepository scenarioVersionRepository;

    @Value("${database.vehicle_sim.remoteUrl}")
    private String remoteUrl;

    public NetworkXml getNetworkXmlByVersionId(String versionId) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/network.xml");
        NetworkXml dto = streamToDto(is);
        return transformNetworkCoordinates(versionId, dto);
    }

    public NetworkXml parseAndTransform(String versionId, java.io.InputStream is) {
        NetworkXml networkXml = networkJaxbParser.parse(is);
        return transformNetworkCoordinates(versionId, networkXml, null, null);
    }

    public NetworkXml parseAndTransform(String versionId, java.io.InputStream is, Double latitude, Double longitude) {
        NetworkXml networkXml = networkJaxbParser.parse(is);
        return transformNetworkCoordinates(versionId, networkXml, latitude, longitude);
    }

    /**
     * 이미 저장된 network.xml(로컬 shape/center 좌표는 그대로 보존)을 새 기준점(lat, lon)으로
     * 다시 계산한다. 파일 재업로드 없이 "임포트된 네트워크의 기준점만 다시 잡는" 기능의 핵심.
     * 반환된 NetworkXml의 base_lat/base_lon 은 새 기준점으로 갱신돼 있어, 호출측이 그대로
     * marshal 해 SFTP에 재저장하면 다음 로드부터도 이 기준점이 우선 사용된다.
     */
    public NetworkXml reanchor(String versionId, double newLatitude, double newLongitude) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/network.xml");
        NetworkXml raw = networkJaxbParser.parse(is); // 로컬 shape 그대로 — 좌표(coordinates)는 아직 미계산
        NetworkXml transformed = transformNetworkCoordinates(versionId, raw, newLatitude, newLongitude);
        transformed.setBaseLat(newLatitude);
        transformed.setBaseLon(newLongitude);
        // 회전/축척은 건드리지 않음 — transformNetworkCoordinates가 raw(=transformed)에 이미
        // 있던 base_rotation/base_scale을 그대로 재사용해 적용했으므로 raw의 필드값도 이미 최신.
        return transformed;
    }

    /**
     * 2점 캘리브레이션 — "지도에 표시된 현재 위치" 두 지점이 실제로는 어디에 있어야 하는지(목표
     * 위치) 지정하면, 그 두 쌍으로부터 회전각과 축척을 함께 역산해 네트워크 전체에 적용한다.
     * 로컬 shape/center 좌표는 그대로 보존되고, 새 base_lat/base_lon/base_rotation/base_scale
     * 로 매 로드 시 재계산되도록 network.xml에 기록된다.
     *
     * <p>이미 이전에 캘리브레이션(또는 reanchor)이 적용된 네트워크를 다시 캘리브레이션해도,
     * "현재 지도 위 클릭 지점"을 현재 base_rotation/base_scale까지 반영해 역산하므로 정확히
     * 누적 적용된다(이전 보정을 무시하고 덮어쓰는 것이 아니라, 그 위에서 다시 맞추는 것).
     *
     * @param srcLat1,srcLon1 기준점 1 — 네트워크 상에 현재 표시된 위치(클릭 지점)
     * @param dstLat1,dstLon1 기준점 1 — 실제로 있어야 할 위치(목표)
     * @param srcLat2,srcLon2 기준점 2 — 네트워크 상에 현재 표시된 위치
     * @param dstLat2,dstLon2 기준점 2 — 실제로 있어야 할 위치
     */
    public NetworkXml calibrate(String versionId,
                                 double srcLat1, double srcLon1, double dstLat1, double dstLon1,
                                 double srcLat2, double srcLon2, double dstLat2, double dstLon2) throws IOException {
        InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/network.xml");
        NetworkXml raw = networkJaxbParser.parse(is);

        double curBaseLat;
        double curBaseLon;
        if (raw.getBaseLat() != null && raw.getBaseLon() != null) {
            curBaseLat = raw.getBaseLat();
            curBaseLon = raw.getBaseLon();
        } else {
            Scenario scenario = scenarioVersionRepository.findByKey(versionId)
                    .map(ScenarioVersion::toEffectiveScenario)
                    .orElseGet(() -> scenarioRepository.findByKey(versionId).orElse(null));
            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                throw new IllegalStateException("현재 기준 좌표를 찾을 수 없습니다. 기준점을 먼저 설정하세요.");
            }
            curBaseLat = scenario.getLatitude();
            curBaseLon = scenario.getLongitude();
        }
        double curRotationRad = Math.toRadians(raw.getBaseRotation() != null ? raw.getBaseRotation() : 0.0);
        double curScale = raw.getBaseScale() != null ? raw.getBaseScale() : 1.0;

        // "현재 지도 위 클릭 지점"을 로컬 shape 좌표로 역산(현재 회전/축척까지 반영해 정확히 되돌림)
        double[] local1 = CoordinateUtils.inverseTransform(curBaseLon, curBaseLat, srcLon1, srcLat1, curRotationRad, curScale);
        double[] local2 = CoordinateUtils.inverseTransform(curBaseLon, curBaseLat, srcLon2, srcLat2, curRotationRad, curScale);

        double dxLocal = local2[0] - local1[0];
        double dyLocal = local2[1] - local1[1];
        double localDist = Math.hypot(dxLocal, dyLocal);
        if (localDist < 1e-6) {
            throw new IllegalArgumentException("기준점 1과 기준점 2(네트워크 상 위치)가 너무 가깝습니다. 서로 떨어진 지점을 선택하세요.");
        }

        double dxTarget = (dstLon2 - dstLon1) * CoordinateUtils.METERS_PER_DEGREE_LNG;
        double dyTarget = (dstLat2 - dstLat1) * CoordinateUtils.METERS_PER_DEGREE_LAT;
        double targetDist = Math.hypot(dxTarget, dyTarget);
        if (targetDist < 1e-6) {
            throw new IllegalArgumentException("목표 지점 1과 목표 지점 2가 너무 가깝습니다. 서로 떨어진 지점을 선택하세요.");
        }

        // 두 벡터(로컬 shape 상의 점1→점2, 목표 실좌표 상의 점1→점2) 비교로 회전각·축척 동시 산출
        double newScale = targetDist / localDist;
        double newRotationRad = Math.atan2(dyTarget, dxTarget) - Math.atan2(dyLocal, dxLocal);

        // 기준점 1(local1)이 목표점 1(dst1)에 정확히 맞도록 새 base_lat/base_lon 역산
        double cos = Math.cos(newRotationRad);
        double sin = Math.sin(newRotationRad);
        double rx1 = (local1[0] * cos - local1[1] * sin) * newScale;
        double ry1 = (local1[0] * sin + local1[1] * cos) * newScale;
        double newBaseLon = dstLon1 - rx1 / CoordinateUtils.METERS_PER_DEGREE_LNG;
        double newBaseLat = dstLat1 - ry1 / CoordinateUtils.METERS_PER_DEGREE_LAT;
        double newRotationDeg = Math.toDegrees(newRotationRad);

        NetworkXml transformed = transformNetworkCoordinates(
                versionId, raw, newBaseLat, newBaseLon, newRotationDeg, newScale);
        transformed.setBaseLat(newBaseLat);
        transformed.setBaseLon(newBaseLon);
        transformed.setBaseRotation(newRotationDeg);
        transformed.setBaseScale(newScale);
        return transformed;
    }

    public byte[] getRawXmlBytes(String versionId) throws IOException {
        // versionId → 실제 경로 조회 (getNetworkXmlByVersionId와 동일 경로 사용)
        try (InputStream is = RemoteXmlFetch.openStream(remoteUrl + versionId + "/network.xml")) {
            return is.readAllBytes();
        }
    }


    public NetworkXml streamToDto(InputStream is) {
        final long totalStart = System.nanoTime();
        NetworkXml networkDto = networkJaxbParser.parse(is);
        final long totalEnd = System.nanoTime();
        log.info("NetworkData streamToDto total:{}", totalEnd - totalStart);
        return networkDto;
    }

    /** 좌표 없을 경우 null 반환 (호출부에서 처리) */
    public boolean hasMissingCoordinates(String versionKey) {
        Scenario scenario = scenarioVersionRepository.findByKey(versionKey)
                .map(ScenarioVersion::toEffectiveScenario)
                .orElseGet(() -> scenarioRepository.findByKey(versionKey).orElse(null));
        return scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null;
    }

    public NetworkXml transformNetworkCoordinates(String versionKey, NetworkXml dto) {
        return transformNetworkCoordinates(versionKey, dto, null, null);
    }

    public NetworkXml transformNetworkCoordinates(String versionKey, NetworkXml dto, Double overrideLatitude, Double overrideLongitude) {
        return transformNetworkCoordinates(versionKey, dto, overrideLatitude, overrideLongitude, null, null);
    }

    /**
     * @param overrideRotationDeg 회전각(도) override — null이면 dto.getBaseRotation()(없으면 0)을 사용
     * @param overrideScale       축척 override — null이면 dto.getBaseScale()(없으면 1)을 사용
     */
    public NetworkXml transformNetworkCoordinates(String versionKey, NetworkXml dto, Double overrideLatitude, Double overrideLongitude,
                                                   Double overrideRotationDeg, Double overrideScale) {
        double baseLatitude;
        double baseLongitude;

        if (overrideLatitude != null && overrideLongitude != null) {
            baseLatitude = overrideLatitude;
            baseLongitude = overrideLongitude;
        } else if (dto.getBaseLat() != null && dto.getBaseLon() != null) {
            // network.xml에 base 좌표가 기록된 경우 최우선 사용 (import 시 origin과 일치 보장)
            baseLatitude  = dto.getBaseLat();
            baseLongitude = dto.getBaseLon();
            log.info("[NetworkService] network.xml base 좌표 사용: lat={}, lon={}", baseLatitude, baseLongitude);
        } else {
            Scenario scenario = scenarioVersionRepository.findByKey(versionKey)
                    .map(ScenarioVersion::toEffectiveScenario)
                    .orElseGet(() -> scenarioRepository.findByKey(versionKey).orElse(null));

            if (scenario == null || scenario.getLatitude() == null || scenario.getLongitude() == null) {
                log.warn("[NetworkService] versionKey={}에 대한 시나리오 좌표를 찾을 수 없습니다.", versionKey);
                return dto;
            }
            baseLatitude = scenario.getLatitude();
            baseLongitude = scenario.getLongitude();
        }

        double rotationRad = Math.toRadians(
                overrideRotationDeg != null ? overrideRotationDeg
                        : (dto.getBaseRotation() != null ? dto.getBaseRotation() : 0.0)
        );
        double scale = overrideScale != null ? overrideScale
                : (dto.getBaseScale() != null ? dto.getBaseScale() : 1.0);

        dto.getNodes().forEach(node -> {
            List<Coordinates> transformedNodeCoords = CoordinateUtils.parseAndTransform(
                    node.getCenter(), baseLongitude, baseLatitude, rotationRad, scale
            );
            if (!transformedNodeCoords.isEmpty()) {
                node.setCoordinates(transformedNodeCoords.getFirst());
            }
        });

        dto.getLinks().forEach(link -> {
            link.setCoordinates(CoordinateUtils.parseAndTransform(
                    link.getShape(), baseLongitude, baseLatitude, rotationRad, scale
            ));
        });

        // 커넥션 shape도 동일한 좌표 변환 적용
        dto.getNodes().forEach(node -> {
            if (node.getConnections() == null) return;
            node.getConnections().forEach(conn ->
                conn.setCoordinates(CoordinateUtils.parseAndTransform(
                        conn.getShape(), baseLongitude, baseLatitude, rotationRad, scale
                ))
            );
        });

        return dto;
    }
}