package com.iitp.iitp_rest;

import com.iitp.iitp_rest.model.scenario.Scenario;
import com.iitp.iitp_rest.model.scenario.ScenarioVersion;
import com.iitp.iitp_rest.repository.ScenarioRepository;
import com.iitp.iitp_rest.repository.ScenarioVersionRepository;
import com.iitp.iitp_rest.service.scenario.ScenarioServiceImpl;
import com.iitp.iitp_rest.service.scenario.ScenarioVersionCloneService;
import com.iitp.iitp_rest.service.scenario.ScenarioVersionPurgeService;
import com.iitp.iitp_rest.util.FileStorageService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * ScenarioServiceImpl.deleteVersion/deleteScenario가 실제로 ScenarioVersionPurgeService를
 * 호출하는지 배선 검증 — purge 로직 자체의 정확성은 ScenarioVersionPurgeServiceTest가 담당,
 * 여기서는 "삭제 시점에 올바른 key로 호출되는가"만 확인한다.
 */
class ScenarioVersionDeleteCascadeTest {

    private final ScenarioRepository scenarioRepository = mock(ScenarioRepository.class);
    private final ScenarioVersionRepository versionRepository = mock(ScenarioVersionRepository.class);
    private final FileStorageService fileStorage = mock(FileStorageService.class);
    private final ScenarioVersionCloneService versionCloneService = mock(ScenarioVersionCloneService.class);
    private final ScenarioVersionPurgeService versionPurgeService = mock(ScenarioVersionPurgeService.class);

    private ScenarioServiceImpl service() {
        return new ScenarioServiceImpl(scenarioRepository, versionRepository, fileStorage,
                versionCloneService, versionPurgeService);
    }

    @Test
    void deleteVersion_purges_that_versions_data() {
        Scenario scenario = Scenario.builder().id(1L).key("scenario1").build();
        ScenarioVersion v1 = ScenarioVersion.builder().id(10L).scenario(scenario).key("scenario1_2").build();
        ScenarioVersion v2 = ScenarioVersion.builder().id(11L).scenario(scenario).key("scenario1_3").build();
        when(versionRepository.findById(10L)).thenReturn(Optional.of(v1));
        when(versionRepository.findByScenarioId(1L)).thenReturn(List.of(v1, v2)); // 2개 있어야 삭제 허용

        service().deleteVersion(1L, 10L);

        verify(versionRepository).deleteById(10L);
        verify(versionPurgeService).purgeVersionData("scenario1_2");
        verifyNoMoreInteractions(versionPurgeService);
    }

    @Test
    void deleteVersion_refuses_when_last_remaining_version() {
        Scenario scenario = Scenario.builder().id(1L).key("scenario1").build();
        ScenarioVersion v1 = ScenarioVersion.builder().id(10L).scenario(scenario).key("scenario1_2").build();
        when(versionRepository.findById(10L)).thenReturn(Optional.of(v1));
        when(versionRepository.findByScenarioId(1L)).thenReturn(List.of(v1));

        assertThrows(IllegalArgumentException.class, () -> service().deleteVersion(1L, 10L));
        verify(versionRepository, never()).deleteById(any());
        verifyNoInteractions(versionPurgeService);
    }

    @Test
    void deleteScenario_purges_every_version_and_base_key() {
        Scenario scenario = Scenario.builder().id(1L).key("scenario1").build();
        ScenarioVersion v1 = ScenarioVersion.builder().id(10L).scenario(scenario).key("scenario1_2").build();
        ScenarioVersion v2 = ScenarioVersion.builder().id(11L).scenario(scenario).key("scenario1_3").build();
        when(scenarioRepository.findById(1L)).thenReturn(Optional.of(scenario));
        when(versionRepository.findByScenarioId(1L)).thenReturn(List.of(v1, v2));

        service().deleteScenario(1L);

        verify(scenarioRepository).deleteById(1L);
        verify(versionPurgeService).purgeVersionData("scenario1_2");
        verify(versionPurgeService).purgeVersionData("scenario1_3");
        // base key(scenario1)는 버전 key 목록에 없으므로 별도로도 정리돼야 함
        verify(versionPurgeService).purgeVersionData("scenario1");
    }

    @Test
    void deleteScenario_does_not_double_purge_base_key_when_it_matches_a_version_key() {
        // 버전 key가 우연히 시나리오 base key와 같은 극단 케이스 — 중복 호출 방지
        Scenario scenario = Scenario.builder().id(1L).key("scenario1").build();
        ScenarioVersion v1 = ScenarioVersion.builder().id(10L).scenario(scenario).key("scenario1").build();
        when(scenarioRepository.findById(1L)).thenReturn(Optional.of(scenario));
        when(versionRepository.findByScenarioId(1L)).thenReturn(List.of(v1));

        service().deleteScenario(1L);

        verify(versionPurgeService, times(1)).purgeVersionData("scenario1");
    }
}
