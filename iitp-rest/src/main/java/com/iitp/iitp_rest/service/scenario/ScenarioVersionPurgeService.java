package com.iitp.iitp_rest.service.scenario;

import com.iitp.iitp_rest.repository.BusStationLogsRepository;
import com.iitp.iitp_rest.repository.BusStationVersionsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingLogsRepository;
import com.iitp.iitp_rest.repository.PavementMarkingVersionsRepository;
import com.iitp.iitp_rest.repository.RailStationLogsRepository;
import com.iitp.iitp_rest.repository.RailStationVersionsRepository;
import com.iitp.iitp_rest.repository.SignalLogsRepository;
import com.iitp.iitp_rest.repository.SignalVersionsRepository;
import com.iitp.iitp_rest.repository.VehicleRouteRepository;
import com.iitp.iitp_rest.repository.XmlLayerLogRepository;
import com.iitp.iitp_rest.repository.XmlLayerVersionRepository;
import com.iitp.iitp_rest.service.network.NetworkTileService;
import com.iitp.iitp_rest.util.FileStorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 시나리오 버전 삭제 시 그 버전에 딸린 모든 산출물을 연쇄 정리한다.
 *
 * <p>기존에는 {@code ScenarioServiceImpl.deleteVersion}이 DB의 버전 레코드 하나만 지우고
 * 나머지는 전부 방치했다 — SFTP의 버전 폴더(network.xml/signal.xml/signalTOD.xml/
 * odmatrix.xml/노선 파일/vehicle_sim.db), xml_layer_versions·signal_versions·
 * 정류장/노면표시 버전·vehicle_route DB 캐시, 네트워크 타일 SQLite가 부모 없는 채로
 * 영구히 남아 스토리지가 조용히 누적됐다(같은 key 재사용 시 새 데이터가 덮어써서 눈에는
 * 안 띄던 문제).
 *
 * <p>DB 레코드 정리 대상은 {@code NetworkController}의 재임포트용 종속 데이터 삭제
 * 엔드포인트와 동일한 세트를 쓴다 — 거기서 이미 검증된 목록이고, 새 버전 스코프 저장소가
 * 생기면 두 곳 다 추가해야 한다.
 *
 * <p>정리는 전부 <b>best-effort</b>다 — 버전 레코드 삭제(사용자 의도의 본체)가 파일 서버
 * 장애 때문에 막히면 안 되므로, 각 단계는 실패해도 로그만 남기고 계속 진행한다.
 * 남은 찌꺼기는 같은 key로 재임포트하면 어차피 덮어써지므로 기능상 해가 없다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScenarioVersionPurgeService {

    private final FileStorageService fileStorage;
    private final XmlLayerVersionRepository xmlLayerVersionRepository;
    private final XmlLayerLogRepository xmlLayerLogRepository;
    private final SignalVersionsRepository signalVersionsRepository;
    private final SignalLogsRepository signalLogsRepository;
    private final BusStationVersionsRepository busStationVersionsRepository;
    private final BusStationLogsRepository busStationLogsRepository;
    private final RailStationVersionsRepository railStationVersionsRepository;
    private final RailStationLogsRepository railStationLogsRepository;
    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository;
    private final PavementMarkingLogsRepository pavementMarkingLogsRepository;
    private final VehicleRouteRepository vehicleRouteRepository;
    private final NetworkTileService networkTileService;

    /** 버전 key(versionId)에 딸린 모든 산출물 정리. 각 단계 실패는 무시(로그만). */
    public void purgeVersionData(String versionKey) {
        if (versionKey == null || versionKey.isBlank()) return;

        // 1) DB 캐시 레코드 — 저장소별로 개별 try (하나 실패해도 나머지는 정리)
        runQuiet(versionKey, "xml_layer", () -> {
            xmlLayerVersionRepository.deleteByVersionId(versionKey);
            xmlLayerVersionRepository.deleteByVersionId(versionKey + ":origin");
            xmlLayerLogRepository.deleteByVersionId(versionKey);
        });
        runQuiet(versionKey, "signal", () -> {
            signalLogsRepository.deleteByVersionId(versionKey);
            signalVersionsRepository.deleteByVersionId(versionKey);
        });
        runQuiet(versionKey, "busStation", () -> {
            busStationLogsRepository.deleteByVersionId(versionKey);
            busStationVersionsRepository.deleteByVersionId(versionKey);
        });
        runQuiet(versionKey, "railStation", () -> {
            railStationLogsRepository.deleteByVersionId(versionKey);
            railStationVersionsRepository.deleteByVersionId(versionKey);
        });
        runQuiet(versionKey, "pavementMarking", () -> {
            pavementMarkingLogsRepository.deleteByVersionId(versionKey);
            pavementMarkingVersionsRepository.deleteByVersionId(versionKey);
        });
        runQuiet(versionKey, "vehicleRoute", () -> vehicleRouteRepository.deleteByVersionId(versionKey));

        // 2) 네트워크 타일 SQLite (메모리 캐시 + 영속 파일)
        runQuiet(versionKey, "networkTile", () -> networkTileService.invalidate(versionKey));

        // 3) 파일 스토리지의 버전 폴더 통째 삭제 — vehicle_sim.db, 노선 파일 등 위 DB 정리가
        //    모르는 파일까지 전부 여기서 함께 사라진다.
        runQuiet(versionKey, "fileDirectory", () -> fileStorage.deleteDirectory(versionKey));

        log.info("[VersionPurge] 버전 산출물 정리 완료: {}", versionKey);
    }

    @FunctionalInterface
    private interface PurgeStep { void run() throws Exception; }

    private static void runQuiet(String versionKey, String stepName, PurgeStep step) {
        try {
            step.run();
        } catch (Exception e) {
            log.warn("[VersionPurge] {} {} 정리 실패(무시): {}", versionKey, stepName, e.getMessage());
        }
    }
}
