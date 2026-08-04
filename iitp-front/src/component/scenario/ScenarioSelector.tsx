import React, { useEffect, useRef, useState } from "react";
import { useScenarioStore } from "@stores/useScenarioStore";
import { useAppSettingsStore } from "@stores/useAppSettingsStore";
import { Scenario, ScenarioVersions } from "@type/Scenario";
import { generateScenarioKey } from "@utils/scenarioKey";
import ScenarioPreviewPopover from "./ScenarioPreviewPopover";

interface ScenarioForm {
    key: string;
    label: string;
    description: string;
    longitude: string;
    latitude: string;
}

type KeyStatus = "idle" | "checking" | "ok" | "invalid";
type ModalMode = "create" | "edit";

const EMPTY_FORM: ScenarioForm = { key: "", label: "", description: "", longitude: "", latitude: "" };
const MAX_KEY_GENERATION_ATTEMPTS = 5;

const ScenarioSelector = () => {
    const theme = useAppSettingsStore((s) => s.theme);
    const setScenario = useScenarioStore((state) => state.setScenario);
    const setVersion  = useScenarioStore((state) => state.setVersion);
    const [scenarioList, setScenarioList]   = useState<Scenario[]>([]);
    const [showModal, setShowModal]         = useState(false);
    const [modalMode, setModalMode]         = useState<ModalMode>("create");
    const [editingId, setEditingId]         = useState<number | null>(null);
    const [form, setForm]                   = useState<ScenarioForm>(EMPTY_FORM);
    const [keyStatus, setKeyStatus]         = useState<KeyStatus>("idle");
    const [submitting, setSubmitting]       = useState(false);
    const [error, setError]                 = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<Scenario | null>(null);
    const keyGenerationRef                  = useRef(0);

    /* ── hover 미리보기 ── */
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const hoverTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCardMouseEnter = (scenario: Scenario) => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        // 빠르게 스쳐 지나가는 hover 에서는 지도를 새로 띄우지 않도록 약간 지연
        hoverTimerRef.current = setTimeout(() => setHoveredKey(scenario.key), 250);
    };
    const handleCardMouseLeave = () => {
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        setHoveredKey(null);
    };
    useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }, []);

    // hover 미리보기에서 버전을 클릭하면 시나리오 선택 화면에서 바로 그 버전으로 진입
    // (별도의 "버전 선택" 팝업 단계는 제거 — 버전 선택은 hover 미리보기로 통일)
    const handleSelectVersion = (scenario: Scenario, version: ScenarioVersions) => {
        setScenario(scenario);
        setVersion(version);
    };

    // hover 없이 카드를 바로 클릭한 경우(팝업 미표시) — 최근 수정된 버전으로 바로 진입.
    // (구 VersionPopup 이 하던 "버전 1개면 자동 선택"을 일반화 — 특정 버전을 고르고
    // 싶으면 hover 미리보기에서 해당 버전을 클릭)
    const handleCardClick = async (scenario: Scenario) => {
        try {
            const res = await fetch(import.meta.env.VITE_API_URL + `/scenario/${scenario.id}/versions`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });
            const data: ScenarioVersions[] = await res.json();
            if (!data.length) return; // 버전이 없는 시나리오 — 진입 불가(조용히 무시)
            const latest = [...data].sort((a, b) => (b.modifyDate ?? "").localeCompare(a.modifyDate ?? ""))[0]!;
            handleSelectVersion(scenario, latest);
        } catch {
            // 무시 — 카드에서 다시 클릭해 재시도 가능
        }
    };

    const fetchScenarios = () => {
        fetch(import.meta.env.VITE_API_URL + "/scenario", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        })
            .then((r) => r.json())
            .then((data) => setScenarioList(data));
    };

    useEffect(() => { fetchScenarios(); }, []);

    const checkScenarioKeyExists = async (key: string) => {
        if (scenarioList.some((scenario) => scenario.key === key)) return true;

        const res = await fetch(
            `${import.meta.env.VITE_API_URL}/scenario/check-key?key=${encodeURIComponent(key)}`
        );
        if (!res.ok) throw new Error("시나리오 키 중복 확인 실패");
        return await res.json() as boolean;
    };

    const findAvailableScenarioKey = async (firstCandidate?: string) => {
        for (let attempt = 0; attempt < MAX_KEY_GENERATION_ATTEMPTS; attempt += 1) {
            const candidate = attempt === 0 && firstCandidate ? firstCandidate : generateScenarioKey();
            if (!await checkScenarioKeyExists(candidate)) return candidate;
        }
        throw new Error("고유한 시나리오 키 생성 실패");
    };

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    /* ── 생성 모달 열기 ── */
    const openCreateModal = () => {
        const requestId = ++keyGenerationRef.current;
        const candidate = generateScenarioKey();

        setModalMode("create");
        setEditingId(null);
        setForm({ ...EMPTY_FORM, key: candidate });
        setKeyStatus("checking");
        setError(null);
        setShowModal(true);

        void findAvailableScenarioKey(candidate)
            .then((availableKey) => {
                if (keyGenerationRef.current !== requestId) return;
                setForm((prev) => ({ ...prev, key: availableKey }));
                setKeyStatus("ok");
            })
            .catch(() => {
                if (keyGenerationRef.current !== requestId) return;
                setKeyStatus("invalid");
                setError("시나리오 키를 자동 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
            });
    };

    /* ── 수정 모달 열기 ── */
    const openEditModal = (e: React.MouseEvent, scenario: Scenario) => {
        e.stopPropagation();
        setModalMode("edit");
        setEditingId(scenario.id);
        setForm({
            key:         scenario.key,
            label:       scenario.label,
            description: scenario.description ?? "",
            longitude:   scenario.longitude != null ? String(scenario.longitude) : "",
            latitude:    scenario.latitude  != null ? String(scenario.latitude)  : "",
        });
        setKeyStatus("idle");
        setError(null);
        setShowModal(true);
    };

    /* ── 삭제 확인 열기 ── */
    const openDeleteConfirm = (e: React.MouseEvent, scenario: Scenario) => {
        e.stopPropagation();
        setDeleteConfirm(scenario);
    };

    /* ── 삭제 실행 ── */
    const handleDelete = async () => {
        if (!deleteConfirm) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/scenario/${deleteConfirm.id}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("삭제 실패");
            setDeleteConfirm(null);
            fetchScenarios();
        } catch {
            alert("시나리오 삭제에 실패했습니다.");
        }
    };

    /* ── 제출 (생성 / 수정) ── */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (modalMode === "create") {
            if (!form.key.trim() || keyStatus === "invalid") {
                setError("시나리오 키를 자동 생성하지 못했습니다. 모달을 닫고 다시 시도해 주세요.");
                return;
            }
            if (keyStatus === "checking") {
                setError("시나리오 키를 생성하고 있습니다. 잠시 후 다시 시도해 주세요.");
                return;
            }
        }
        if (!form.label.trim()) { setError("이름을 입력해 주세요."); return; }

        setSubmitting(true);
        try {
            const url    = modalMode === "edit"
                ? `${import.meta.env.VITE_API_URL}/scenario/${editingId}`
                : `${import.meta.env.VITE_API_URL}/scenario`;
            const method = modalMode === "edit" ? "PUT" : "POST";

            const body: Record<string, unknown> = {
                label:       form.label.trim(),
                description: form.description.trim(),
            };
            if (modalMode === "edit") {
                // 중심점 UI는 제거하지만 기존 시나리오 좌표는 수정 저장 시 그대로 보존한다.
                body.longitude = form.longitude ? parseFloat(form.longitude) : null;
                body.latitude = form.latitude ? parseFloat(form.latitude) : null;
            } else {
                body.key = form.key.trim();
            }

            let res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            // 생성 직전에 동일 키가 등록된 극히 드문 경우 새 키로 한 번 자동 재시도한다.
            if (modalMode === "create" && !res.ok && await checkScenarioKeyExists(String(body.key))) {
                const replacementKey = await findAvailableScenarioKey();
                body.key = replacementKey;
                setForm((prev) => ({ ...prev, key: replacementKey }));
                res = await fetch(url, {
                    method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
            }
            if (!res.ok) throw new Error("실패");
            handleModalClose();
            fetchScenarios();
        } catch {
            setError(modalMode === "edit" ? "시나리오 수정에 실패했습니다." : "시나리오 생성에 실패했습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleModalClose = () => {
        keyGenerationRef.current += 1;
        setShowModal(false);
        setForm(EMPTY_FORM);
        setKeyStatus("idle");
        setError(null);
    };

    return (
        <div className="scenario-container">
            {theme === 'light' ? (
                // main_back2.mp4는 다크 전용으로 촬영된 야간 영상이라 별도 라이트용 소재가
                // 필요했다 — AI로 생성한 주간 항공뷰 정지 이미지로 교체(사용자 확인).
                <img src="/light_mode_back.png" alt="" className="background-video" />
            ) : (
                <video autoPlay loop muted playsInline className="background-video">
                    <source src="/vod/main_back2.mp4" type="video/mp4" />
                </video>
            )}
            <h1 className="title">교통 시뮬레이션 분석 시스템</h1>
            <p className="description">실제 교통 데이터를 바탕으로 시뮬레이션 결과를 분석하고 시나리오를 선택하세요.</p>

            <div className="card-container">
                {scenarioList?.map((scenario) => (
                    <div
                        key={scenario.key}
                        className="scenario-card"
                        onClick={() => handleCardClick(scenario)}
                        onMouseEnter={() => handleCardMouseEnter(scenario)}
                        onMouseLeave={handleCardMouseLeave}
                    >
                        <div className="scenario-card-actions">
                            <button
                                className="scenario-card-btn scenario-card-btn--edit"
                                onClick={(e) => openEditModal(e, scenario)}
                                title="수정"
                            >✎</button>
                            <button
                                className="scenario-card-btn scenario-card-btn--delete"
                                onClick={(e) => openDeleteConfirm(e, scenario)}
                                title="삭제"
                            >✕</button>
                        </div>
                        <h2>{scenario.label}</h2>
                        <p>{scenario.description}</p>
                        {hoveredKey === scenario.key && (
                            <ScenarioPreviewPopover scenario={scenario} onSelectVersion={handleSelectVersion} />
                        )}
                    </div>
                ))}
                <div className="scenario-card scenario-card--add" onClick={openCreateModal}>
                    <span className="scenario-card--add-icon">+</span>
                    <p>새 시나리오 추가</p>
                </div>
            </div>

            {/* 삭제 확인 다이얼로그 */}
            {deleteConfirm && (
                <div className="version-popup" onClick={() => setDeleteConfirm(null)}>
                    <div className="version-popup-content scenario-create-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>시나리오 삭제</h2>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "8px 0 20px" }}>
                            <strong style={{ color: "var(--text-primary)" }}>{deleteConfirm.label}</strong> 시나리오를 삭제합니다.<br />
                            버전 데이터를 포함한 모든 정보가 삭제되며 복구할 수 없습니다.
                        </p>
                        <div className="scenario-form-actions">
                            <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-cancel">취소</button>
                            <button type="button" onClick={handleDelete} style={{ background: "rgba(var(--color-danger-rgb), 0.25)", borderColor: "rgba(var(--color-danger-rgb), 0.6)", color: "var(--color-danger)" }}>
                                삭제
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 생성 / 수정 모달 */}
            {showModal && (
                <div className="version-popup" onClick={handleModalClose}>
                    <div className="version-popup-content scenario-create-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>{modalMode === "edit" ? "시나리오 수정" : "시나리오 추가"}</h2>
                        <form onSubmit={handleSubmit} className="scenario-create-form">

                            {/* 이름 */}
                            <div className="scenario-form-row">
                                <label>이름 *</label>
                                <input
                                    name="label"
                                    value={form.label}
                                    onChange={handleFormChange}
                                    placeholder="시나리오 이름"
                                />
                            </div>

                            {/* 설명 */}
                            <div className="scenario-form-row">
                                <label>설명</label>
                                <textarea
                                    name="description"
                                    value={form.description}
                                    onChange={handleFormChange}
                                    placeholder="시나리오 설명"
                                    rows={2}
                                />
                            </div>

                            {error && <p className="scenario-form-error">{error}</p>}

                            <div className="scenario-form-actions">
                                <button type="button" onClick={handleModalClose} className="btn-cancel">취소</button>
                                <button
                                    type="submit"
                                    disabled={submitting || (modalMode === "create" && (keyStatus === "checking" || keyStatus === "invalid"))}
                                >
                                    {submitting ? "저장 중..." : modalMode === "edit" ? "수정" : "추가"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
};

export default ScenarioSelector;
