import React, { useEffect, useState } from "react";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Scenario } from "@type/Scenario";

const ScenarioSelector = () => {

    const setScenario = useScenarioStore((state) => state.setScenario);

    const [scenarioList, setScenarioList] = useState<Scenario[]>([]);

    const handleScenarioSelect = (scenario: Scenario) => {
        setScenario(scenario);
    };

    useEffect(() => {
        fetch(process.env.VITE_API_URL + "/scenario", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        }).then((response) => {
            return response.json();
        })
            .then((data) => {
                setScenarioList(data);
            })
    }, []);


    return (
        <div className="scenario-container">
            <video
                autoPlay
                loop
                muted
                playsInline
                className="background-video"
            >
                <source src="/vod/main_back2.mp4" type="video/mp4"/>
            </video>
            <h1 className="title">교통 시뮬레이션 분석 시스템</h1>
            <p className="description">실제 교통 데이터를 바탕으로 시뮬레이션 결과를 분석하고 시나리오를 선택하세요.</p>

            <div className="card-container">

                {scenarioList?.map((scenario) => (
                    <div
                        key={scenario.key}
                        className="scenario-card"
                        onClick={() => handleScenarioSelect(scenario)}
                    >
                        <h2>{scenario.label}</h2>
                        <p>{scenario.description}</p>
                    </div>
                ))}

            </div>
        </div>
    );

}

export default ScenarioSelector;
