import React, { useEffect, useMemo, useRef, useState } from 'react';
import "/static/css/styles.css";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import VectorLayer from "ol/layer/Vector";
import { apiConfig, ApiMenuKey } from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import JsonGrid from "@component/util/JsonGrid";
import { faChevronDown, faChevronUp, } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import useHistoryInit, { menuCodeToHistoryStoreMap } from "@hooks/useHistoryInit";
import { mergeJsonWithLogRecursive, mergeUpdateLogs } from "@utils/history";
import HistoryController from "@component/modal/HistoryController";
import HistoryModal from "@component/modal/HistoryModal";
import { useScenarioStore } from "@stores/useScenarioStore";
import { useSelectionStore } from "@stores/useSelectionStore";
import { faClose } from "@fortawesome/free-solid-svg-icons/faClose";
import deepEqual from "deep-equal";
import { FeatureLayerAPI, isFeatureLayer } from "@features/FeatureLayerAPI";
import { matchesCustomKeyValue } from "@utils/olLayer";
import { useMessageStore } from "@stores/useMessageStore";
import { useShallow } from "zustand/react/shallow";
import { useEventStore } from "@stores/useEventStore";
import { modifyFeatureEventHandlers } from "@handler/modifyFeatureEventHandlers";
import { extractFeatureTypeFromGuid } from "@utils/guid";
import { MenuTreeResponse } from "@type/openapi.gen";

export interface PropertyPanelProps {
    activeSubmenu: MenuTreeResponse
    onClose: () => void;
}

const PropertyPanel = ({activeSubmenu, onClose}: PropertyPanelProps) => {
    const submenu = {
        item: propertyFormSchema[activeSubmenu.menuCode],
    }

    // 동적 스토어
    const store = menuCodeToStoreMap[activeSubmenu.menuCode]
    const selectedGuid = useSelectionStore(useShallow((state) => state.selectedGuid))
    const clearSelected = useSelectionStore((state) => state.clearSelected)
    const selectedGuidRef = useRef<(string | number | React.Key)[]>([])
    const historyStore = menuCodeToHistoryStoreMap[activeSubmenu.menuCode];

    const currentJsonData = store(useShallow((state: {currentJsonData: unknown}) => state.currentJsonData))

    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const olMap = useOpenLayersStore.state.map()
    type BodySize = "mini" | "default" | "full";
    const [bodySize, setBodySize] = useState<BodySize>("default");
    const setMessage = useMessageStore.getState().setMessage;

    const layer = useMemo<FeatureLayerAPI & VectorLayer | undefined>(() => {
        const foundLayer = olMap?.getLayers().getArray()
            .find(layer => matchesCustomKeyValue(layer, 'layer', submenu.item.layer))

        if (foundLayer && isFeatureLayer(foundLayer)) {
            console.log("foundLayer:::", foundLayer)
            return foundLayer;
        }
        return undefined;
    }, [olMap, activeSubmenu.menuCode]);

    useEffect(() => {
        if (!selectedGuidRef || !layer) return;

        const prevGuids: (string | number | React.Key)[] = selectedGuidRef.current;
        const nextGuids: (string | number | React.Key)[] = selectedGuid;

        if (deepEqual(prevGuids, nextGuids)) return;
        const source = layer.getSource();
        if (!source) return;

        // 상태 갱신
        selectedGuidRef.current = nextGuids;
    }, [selectedGuid]);

    // openlayers와 cesium에서 해당 guid 내의 featureType을 추출
    // 추출한 featureType을 가진 객체를 찾아 이벤트를 생성한다.
    useEffect(() => {
        if (!submenu.item.layer) return;

        const featureTypeSet = new Set<string>(
            (selectedGuid ?? [])
                .map(extractFeatureTypeFromGuid)
                .filter((v): v is string => !!v)
        );

        const disposers: Array<() => void> = [];
        featureTypeSet.forEach((featureType) => {
            const dispose = modifyFeatureEventHandlers(featureType);
            if (typeof dispose === "function") disposers.push(dispose);
        });

        return () => {
            for (let i = disposers.length - 1; i >= 0; i--) {
                try {
                    disposers[i]();
                } catch {
                }
            }
        };
    }, [selectedGuid, submenu.item.layer]);

    useEffect(() => {
        clearSelected()
    }, [activeSubmenu]);

    const [reloadFlag, setReloadFlag] = useState(false);

    useHistoryInit(reloadFlag);

    const handleCheck = () => {
        console.log("current originData:", store.getState().originData) // 디버깅용
        console.log("current currentJsonData:", store.getState().currentJsonData) // 디버깅용
        console.log("current event:", useEventStore.getState().olEventManager?.getListenerKey()) // 디버깅용
        console.log("current selectedGuid:", selectedGuid) // 디버깅용
    };

    const handleSaveBtn = async () => {
        const api = apiConfig[activeSubmenu.menuCode as ApiMenuKey]?.update;
        if (!api) return;
        const currentJson = store.getState().currentJsonData;
        const logJson = historyStore.getState().updateLogs;
        const snapshotLogJson = historyStore.getState().snapshotUpdateLogs;
        if (!logJson) {
            setMessage({
                type: 'warn',
                text: '변경사항이 없습니다.',
            });
            return
        }
        const mergedLog = mergeUpdateLogs(logJson, snapshotLogJson);
        const extractedArray = Object.values(currentJson)[0];
        const payload = {
            data: extractedArray,
            logs: mergedLog,
        };
        try {
            if (!selectedScenario) return;
            await axiosInstance({
                method: api.method,
                url: api.url + '/' + selectedScenario.key,
                data: payload,
            });

            historyStore.getState().resetUpdateLogs();
            setReloadFlag(prev => !prev);
            setMessage({
                type: 'info',
                text: '저장 완료',
            });
        } catch (error) {
            setMessage({
                type: 'error',
                text: '저장 실패: ' + error,
            });
        }
    }

    const handleInitBtn = () => {
        store.getState().initCurrentData();
        historyStore.getState().resetAllHistoryStack();
        historyStore.getState().setCurrentSnapshotIndex(null);
    }

    const handleShowHistory = () => {
        setIsHistoryOpen(true);
    }

    const handleHistoryApply = (isUndo: boolean) => {
        if (!historyStore) return;
        const historyFn = isUndo ? historyStore.getState().undo : historyStore.getState().redo;
        const updateHistory = historyFn();

        if (!updateHistory) {
            console.warn(isUndo ? "No more undo steps available." : "No more redo steps available.");
            return;
        }

        const currentJsonData = store.getState().currentJsonData;

        const mergeJsonData = mergeJsonWithLogRecursive(currentJsonData, updateHistory, isUndo);

        store.getState().setCurrentJsonData(mergeJsonData);

        setMessage({
            type: 'info',
            text: isUndo ? "Undo 성공" : "Redo 성공",
        });

    };

    const increaseSize = () => {
        setBodySize(prev => {
            if (prev === "mini") return "default";
            if (prev === "default") return "full";
            return "full"; // 이미 full이면 유지
        });
    };

    const decreaseSize = () => {
        setBodySize(prev => {
            if (prev === "full") return "default";
            if (prev === "default") return "mini";
            return "mini"; // 이미 mini면 유지
        });
    };

    return (
        <div className={`popup-overlay${submenu?.item?.type ? `-${submenu.item.type}` : ''}`}>
            <div className={`popup-container${submenu?.item?.type ? `-${submenu.item.type}` : ''}`}>
                <div className="popup-header">
                    <span>{activeSubmenu.nameKor}</span>
                    <div className="popup-header-actions">
                        <button className="save-btn" onClick={() => handleInitBtn()}>되돌리기</button>
                        <HistoryController onHistoryAply={handleHistoryApply}></HistoryController>
                        <button onClick={() => handleCheck()}>Interaction 객체 목록 디버깅</button>
                        <button className="btn" onClick={() => handleShowHistory()}>변경 이력 보기</button>
                        <button className="save-btn" onClick={() => handleSaveBtn()}>저장</button>
                    </div>

                    <div>

                        <FontAwesomeIcon className="close-btn" icon={faClose} onClick={onClose}/>
                        {(bodySize !== "full") && (<FontAwesomeIcon
                            className="expand-btn"
                            icon={faChevronUp} // ⬆️ 확대 아이콘
                            onClick={increaseSize}
                            title="확장"
                        />)}
                        {(bodySize !== "mini") && (<FontAwesomeIcon
                            className="collapse-btn"
                            icon={faChevronDown} // ⬇️ 축소 아이콘
                            onClick={decreaseSize}
                            title="축소"
                        />)}

                    </div>

                </div>

                <div className={
                    bodySize === "full" ? "popup-body-full"
                        : bodySize === "mini" ? "popup-body-mini"
                            : "popup-body"
                }>
                    {isHistoryOpen && activeSubmenu.menuCode && (
                        <HistoryModal
                            onClose={() => setIsHistoryOpen(false)}
                            open={isHistoryOpen}
                            menuCode={activeSubmenu.menuCode}
                        />
                    )}
                    {submenu.item && submenu.item.layer &&
                        <div style={{width: "99%"}}>
                            {Object.entries(currentJsonData ?? []).map(([key, value]) => (
                                <div key={key} className="grid-container">
                                    <JsonGrid
                                        layerName={submenu.item.layer}
                                        layerGroupName={"facility"}
                                        rowData={value}
                                        levelName={key}
                                    />
                                </div>
                            ))}
                        </div>
                    }
                </div>
            </div>
        </div>
    );
};

export default PropertyPanel;