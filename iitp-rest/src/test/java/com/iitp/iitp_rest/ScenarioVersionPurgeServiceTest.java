package com.iitp.iitp_rest;

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
import com.iitp.iitp_rest.service.pavementMarking.PavementMarkingTileService;
import com.iitp.iitp_rest.service.publicTransit.station.BusStationTileService;
import com.iitp.iitp_rest.service.publicTransit.station.RailStationTileService;
import com.iitp.iitp_rest.service.scenario.ScenarioVersionPurgeService;
import com.iitp.iitp_rest.service.signal.SignalTileService;
import com.iitp.iitp_rest.util.FileStorageService;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.mockito.Mockito.*;

/**
 * 시나리오 버전 삭제 연쇄 정리 검증 — 기존에는 버전 DB 레코드만 지우고 SFTP 폴더/DB 캐시/
 * 타일 DB가 전부 방치돼 스토리지가 조용히 누적됐다. 이제 purgeVersionData 하나가 전 범위를
 * 정리해야 하고, 일부 단계가 실패해도(파일 서버 장애 등) 나머지 정리는 계속 진행돼야 한다.
 */
class ScenarioVersionPurgeServiceTest {

    private final FileStorageService fileStorage = mock(FileStorageService.class);
    private final XmlLayerVersionRepository xmlLayerVersionRepository = mock(XmlLayerVersionRepository.class);
    private final XmlLayerLogRepository xmlLayerLogRepository = mock(XmlLayerLogRepository.class);
    private final SignalVersionsRepository signalVersionsRepository = mock(SignalVersionsRepository.class);
    private final SignalLogsRepository signalLogsRepository = mock(SignalLogsRepository.class);
    private final BusStationVersionsRepository busStationVersionsRepository = mock(BusStationVersionsRepository.class);
    private final BusStationLogsRepository busStationLogsRepository = mock(BusStationLogsRepository.class);
    private final RailStationVersionsRepository railStationVersionsRepository = mock(RailStationVersionsRepository.class);
    private final RailStationLogsRepository railStationLogsRepository = mock(RailStationLogsRepository.class);
    private final PavementMarkingVersionsRepository pavementMarkingVersionsRepository = mock(PavementMarkingVersionsRepository.class);
    private final PavementMarkingLogsRepository pavementMarkingLogsRepository = mock(PavementMarkingLogsRepository.class);
    private final VehicleRouteRepository vehicleRouteRepository = mock(VehicleRouteRepository.class);
    private final NetworkTileService networkTileService = mock(NetworkTileService.class);
    private final BusStationTileService busStationTileService = mock(BusStationTileService.class);
    private final RailStationTileService railStationTileService = mock(RailStationTileService.class);
    private final SignalTileService signalTileService = mock(SignalTileService.class);
    private final PavementMarkingTileService pavementMarkingTileService = mock(PavementMarkingTileService.class);

    private ScenarioVersionPurgeService service() {
        return new ScenarioVersionPurgeService(
                fileStorage, xmlLayerVersionRepository, xmlLayerLogRepository,
                signalVersionsRepository, signalLogsRepository,
                busStationVersionsRepository, busStationLogsRepository,
                railStationVersionsRepository, railStationLogsRepository,
                pavementMarkingVersionsRepository, pavementMarkingLogsRepository,
                vehicleRouteRepository, networkTileService,
                busStationTileService, railStationTileService, signalTileService, pavementMarkingTileService);
    }

    @Test
    void purges_all_db_records_tile_db_and_file_directory() throws Exception {
        service().purgeVersionData("v1");

        verify(xmlLayerVersionRepository).deleteByVersionId("v1");
        verify(xmlLayerVersionRepository).deleteByVersionId("v1:origin");
        verify(xmlLayerLogRepository).deleteByVersionId("v1");
        verify(signalVersionsRepository).deleteByVersionId("v1");
        verify(signalLogsRepository).deleteByVersionId("v1");
        verify(busStationVersionsRepository).deleteByVersionId("v1");
        verify(busStationLogsRepository).deleteByVersionId("v1");
        verify(railStationVersionsRepository).deleteByVersionId("v1");
        verify(railStationLogsRepository).deleteByVersionId("v1");
        verify(pavementMarkingVersionsRepository).deleteByVersionId("v1");
        verify(pavementMarkingLogsRepository).deleteByVersionId("v1");
        verify(vehicleRouteRepository).deleteByVersionId("v1");
        verify(networkTileService).invalidate("v1");
        verify(busStationTileService).invalidate("v1");
        verify(railStationTileService).invalidate("v1");
        verify(signalTileService).invalidate("v1");
        verify(pavementMarkingTileService).invalidate("v1");
        verify(fileStorage).deleteDirectory("v1");
    }

    @Test
    void continues_remaining_cleanup_when_one_step_fails() throws Exception {
        // 파일 서버 장애 시나리오 — DB/타일 정리는 그대로 진행돼야 하고 예외가 전파되면 안 됨
        doThrow(new IOException("SFTP down")).when(fileStorage).deleteDirectory("v1");
        doThrow(new RuntimeException("db error")).when(signalVersionsRepository).deleteByVersionId("v1");

        service().purgeVersionData("v1"); // 예외 없이 완료돼야 함

        verify(xmlLayerVersionRepository).deleteByVersionId("v1");
        verify(vehicleRouteRepository).deleteByVersionId("v1");
        verify(networkTileService).invalidate("v1");
    }

    @Test
    void ignores_blank_version_key() throws Exception {
        service().purgeVersionData("");
        service().purgeVersionData(null);
        verifyNoInteractions(fileStorage, xmlLayerVersionRepository, networkTileService,
                busStationTileService, railStationTileService, signalTileService, pavementMarkingTileService);
    }
}
