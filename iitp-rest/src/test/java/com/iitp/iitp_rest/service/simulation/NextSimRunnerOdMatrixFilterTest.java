package com.iitp.iitp_rest.service.simulation;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 크래시 복구 이분탐색 도중 garage 로 전환된 터미널을 참조하는 OD 수요가 odmatrix.xml에
 * 고아 참조로 남아 InitializeVehicleDemand()에서 별도의 크래시를 유발하던 문제
 * (실측: scenario1_2 32개 터미널 중 진짜 문제 노드는 1개뿐인데, network.xml만 garage로
 * 바꾸고 odmatrix.xml을 그대로 두면 그 노드를 참조하는 수요가 남아있는 거의 모든 부분집합이
 * 크래시해 이분탐색이 무의미해짐)를 재현/검증한다.
 */
class NextSimRunnerOdMatrixFilterTest {

    private static final String PRISTINE = """
            <?xml version='1.0' encoding='UTF-8'?>
            <Demands>
              <odMatrix id="0" startTime="00:00:00" duration="60">
                <avodMatrix/>
                <nvodMatrix>
                  <demand source="A" sink="B" flow="60" dist=""/>
                  <demand source="A" sink="C" flow="30" dist=""/>
                  <demand source="B" sink="C" flow="10" dist=""/>
                </nvodMatrix>
              </odMatrix>
            </Demands>
            """;

    @Test
    void dropsDemandsReferencingGaragedNode(@TempDir Path tmp) throws IOException {
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(odMatrixXml, PRISTINE);

        NextSimRunner.filterOdMatrixForActive(
                odMatrixXml, PRISTINE, List.of("A", "B", "C"), List.of("A", "C"));

        String result = Files.readString(odMatrixXml);
        assertThat(result).doesNotContain("source=\"A\" sink=\"B\"");
        assertThat(result).doesNotContain("source=\"B\" sink=\"C\"");
        assertThat(result).contains("source=\"A\" sink=\"C\"");
    }

    @Test
    void restoresPristineWhenAllCandidatesActive(@TempDir Path tmp) throws IOException {
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(odMatrixXml, "stale content from a previous trial");

        NextSimRunner.filterOdMatrixForActive(
                odMatrixXml, PRISTINE, List.of("A", "B", "C"), List.of("A", "B", "C"));

        assertThat(Files.readString(odMatrixXml)).isEqualTo(PRISTINE);
    }

    @Test
    void doesNotAccumulateAcrossSuccessiveTrials(@TempDir Path tmp) throws IOException {
        Path odMatrixXml = tmp.resolve("odmatrix.xml");
        Files.writeString(odMatrixXml, PRISTINE);

        // 1차 시도: B 제외 → A-B, B-C 수요 삭제
        NextSimRunner.filterOdMatrixForActive(
                odMatrixXml, PRISTINE, List.of("A", "B", "C"), List.of("A", "C"));
        // 2차 시도: 전부 활성화 — 1차의 삭제가 남아있으면 안 됨(pristine 기준 재작성이라 복원되어야 함)
        NextSimRunner.filterOdMatrixForActive(
                odMatrixXml, PRISTINE, List.of("A", "B", "C"), List.of("A", "B", "C"));

        String result = Files.readString(odMatrixXml);
        assertThat(result).contains("source=\"A\" sink=\"B\"");
        assertThat(result).contains("source=\"B\" sink=\"C\"");
    }
}
