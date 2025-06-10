import React, {useRef} from 'react';
import './App.css'
import Maps from "./component/map/Maps";
import Header from "./component/header/Header";
import LeftPanel from "./component/panel/LeftPanel";
import Tools from "./component/tool/Tools";
import ToolsPanel from "./component/tool/ToolsPanel";
import {useScenarioStore} from "@stores/useScenarioStore";

function App() {

    const version = useScenarioStore((state) => state.selectedScenarioVersion);
    const setVersion = useScenarioStore((state) => state.setVersion);

    const selectedScenario = useScenarioStore((state) => state.selectedScenario);
    const setScenario = useScenarioStore((state) => state.setScenario);

    const handleScenarioSelect = (scenario: string) => {
        setScenario(scenario);
    };

    // 시나리오 선택 화면
    if (!selectedScenario) {
        return (
            <div className="scenario-container">
                <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="background-video"
                >
                    <source src="/vod/main_back2.mp4" type="video/mp4" />
                </video>
                <h1 className="title">교통 시뮬레이션 분석 시스템</h1>
                <p className="description">실제 교통 데이터를 바탕으로 시뮬레이션 결과를 분석하고 시나리오를 선택하세요.</p>

                <div className="card-container">
                    <div className="scenario-card" onClick={() => handleScenarioSelect("morning_rush")}>
                        <h2>출근 시간대 시뮬레이션</h2>
                        <p>오전 7시 ~ 9시 혼잡도 분석</p>
                    </div>
                    <div className="scenario-card" onClick={() => handleScenarioSelect("evening_rush")}>
                        <h2>퇴근 시간대 시뮬레이션</h2>
                        <p>오후 6시 ~ 8시 교차로 체증 분석</p>
                    </div>
                    <div className="scenario-card" onClick={() => handleScenarioSelect("event_traffic")}>
                        <h2>이벤트 발생 시뮬레이션</h2>
                        <p>도심 내 대형 행사에 따른 우회 경로 분석</p>
                    </div>
                </div>
            </div>
        );
    }

  return (
    <>
      <div>
          {/* 버전 선택 팝업 (version이 없을 때만 보여줌) */}
          {!version && (
              <div className="version-popup">
                  <div className="version-popup-content">
                      <h2>시나리오 버전을 선택하세요</h2>
                      <select
                          defaultValue=""
                          onChange={(e) => {
                              const selected = e.target.value;
                              if (selected) {
                                  setVersion(selected);
                              }
                          }}
                      >
                          <option value="" disabled>버전을 선택하세요</option>
                          <option value="v1">version-1</option>
                          <option value="v2">version-2</option>
                      </select>
                  </div>
              </div>
          )}
          <Header />
          <LeftPanel />
          <Tools />
          <ToolsPanel />
          <Maps></Maps>
      </div>
    </>
  )
}

export default App
