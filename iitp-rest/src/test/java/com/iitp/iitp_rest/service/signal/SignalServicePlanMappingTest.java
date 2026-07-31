package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.SignalResponse;
import com.iitp.iitp_rest.model.signal.SignalXml;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SignalServicePlanMappingTest {

    private final SignalService service = new SignalService(null, null, null);

    @Test
    void fromSignalXmlKeepsPlansAndPhasesOnFirstSignalOfNode() {
        SignalXml.TurnListXml turn = new SignalXml.TurnListXml();
        turn.setId("0");
        turn.setTurning("Straight");
        turn.setType("None");
        turn.setConnList("1 2");

        SignalXml.PhaseXml phase = new SignalXml.PhaseXml();
        phase.setId("0");
        phase.setDuration("30");
        phase.setTurnList("0");

        SignalXml.PlanListXml plan = new SignalXml.PlanListXml();
        plan.setId("0");
        plan.setCycle("30");
        plan.setOffset("0");
        plan.setPhase(List.of(phase));

        SignalXml.SignalNodeXml node = new SignalXml.SignalNodeXml();
        node.setId(10000194L);
        node.setTurns(List.of(turn));
        node.setPlans(List.of(plan));

        SignalXml xml = new SignalXml();
        xml.setId(0L);
        xml.setNode(List.of(node));

        List<SignalResponse> result = service.fromSignalXml(xml);

        assertThat(result).hasSize(2);
        assertThat(result.getFirst().getPlans()).hasSize(1);
        assertThat(result.getFirst().getPlans().getFirst().getId()).isEqualTo("0");
        assertThat(result.getFirst().getPlans().getFirst().getPhases())
                .singleElement()
                .satisfies(mappedPhase -> {
                    assertThat(mappedPhase.getDuration()).isEqualTo("30");
                    assertThat(mappedPhase.getTurnList()).isEqualTo("0");
                });
        assertThat(result.get(1).getPlans()).isNull();
    }

    @Test
    void mergeMissingPlansMapsXmlPlansByNodeWithoutOverwritingStoredPlans() {
        SignalResponse storedWithoutPlans = signal("10000194", "0", "1");
        SignalResponse storedWithPlans = signal("10000513", "0", "2");
        storedWithPlans.setPlans(List.of(plan("saved", "45")));

        SignalResponse xmlForMissingNode = signal("10000194", "0", "1");
        xmlForMissingNode.setPlans(List.of(plan("0", "30"), plan("1", "60")));
        SignalResponse xmlForExistingNode = signal("10000513", "0", "2");
        xmlForExistingNode.setPlans(List.of(plan("xml", "90")));

        List<SignalResponse> result = service.mergeMissingPlans(
                List.of(storedWithoutPlans, storedWithPlans),
                List.of(xmlForMissingNode, xmlForExistingNode)
        );

        assertThat(result.getFirst().getPlans())
                .extracting(SignalResponse.PlanData::getId)
                .containsExactly("0", "1");
        assertThat(result.get(1).getPlans())
                .extracting(SignalResponse.PlanData::getId)
                .containsExactly("saved");
    }

    private static SignalResponse signal(String nodeId, String turnId, String connectionId) {
        SignalResponse signal = new SignalResponse();
        signal.setNodeId(nodeId);
        signal.setTurnId(turnId);
        signal.setTurning("Straight");
        signal.setType("None");
        signal.setConnectionId(connectionId);
        return signal;
    }

    private static SignalResponse.PlanData plan(String id, String cycle) {
        SignalResponse.PlanData plan = new SignalResponse.PlanData();
        plan.setId(id);
        plan.setCycle(cycle);
        plan.setOffset("0");
        plan.setPhases(List.of());
        return plan;
    }
}
