import React, { useEffect, useRef, useState } from "react";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Scenario } from "@type/Scenario";
import MapRangePicker from "./MapRangePicker";

interface ScenarioForm {
    key: string;
    label: string;
    description: string;
    longitude: string;
    latitude: string;
}

type KeyStatus = "idle" | "checking" | "ok" | "duplicate" | "invalid";
type ModalMode = "create" | "edit";

const EMPTY_FORM: ScenarioForm = { key: "", label: "", description: "", longitude: "", latitude: "" };
const KEY_REGEX = /^[A-Za-z0-9_]*$/;

const ScenarioSelector = () => {
    const setScenario = useScenarioStore((state) => state.setScenario);
    const [scenarioList, setScenarioList]   = useState<Scenario[]>([]);
    const [showModal, setShowModal]         = useState(false);
    const [modalMode, setModalMode]         = useState<ModalMode>("create");
    const [editingId, setEditingId]         = useState<number | null>(null);
    const [showMapPicker, setShowMapPicker] = useState(false);
    const [form, setForm]                   = useState<ScenarioForm>(EMPTY_FORM);
    const [keyStatus, setKeyStatus]         = useState<KeyStatus>("idle");
    const [submitting, setSubmitting]       = useState(false);
    const [error, setError]                 = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<Scenario | null>(null);
    const debounceRef                       = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchScenarios = () => {
        fetch(import.meta.env.VITE_API_URL + "/scenario", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        })
            .then((r) => r.json())
            .then((data) => setScenarioList(data));
    };

    useEffect(() => { fetchScenarios(); }, []);

    /* ── key 입력 처리 ── */
    const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (!KEY_REGEX.test(val)) return;
        setForm((prev) => ({ ...prev, key: val }));
        if (!val) { setKeyStatus("idle"); return; }
        setKeyStatus("checking");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await fetch(
                    `${import.meta.env.VITE_API_URL}/scenario/check-key?key=${encodeURIComponent(val)}`
                );
                const exists: boolean = await res.json();
                setKeyStatus(exists ? "duplicate" : "ok");
            } catch {
                setKeyStatus("idle");
            }
        }, 400);
    };

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleMapSelect = (lon: number, lat: number) => {
        setForm((prev) => ({ ...prev, longitude: String(lon), latitude: String(lat) }));
        setShowMapPicker(false);
    };

    /* ── 생성 모달 열기 ── */
    const openCreateModal = () => {
        setModalMode("create");
        setEditingId(null);
        setForm(EMPTY_FORM);
        setKeyStatus("idle");
        setError(null);
        setShowModal(true);
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
            if (!form.key.trim())           { setError("키를 입력해 주세요."); return; }
            if (keyStatus === "duplicate")  { setError("이미 사용 중인 키입니다."); return; }
            if (keyStatus === "checking")   { setError("키 중복 확인 중입니다. 잠시 후 다시 시도해 주세요."); return; }
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
                longitude:   form.longitude ? parseFloat(form.longitude) : null,
                latitude:    form.latitude  ? parseFloat(form.latitude)  : null,
            };
            if (modalMode === "create") body.key = form.key.trim();

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
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
        setShowModal(false);
        setForm(EMPTY_FORM);
        setKeyStatus("idle");
        setError(null);
    };

    /* ── key 상태 배지 ── */
    const keyBadge = () => {
        if (keyStatus === "checking")  return <span className="key-badge key-badge--checking">확인 중...</span>;
        if (keyStatus === "ok")        return <span className="key-badge key-badge--ok">✓ 사용 가능</span>;
        if (keyStatus === "duplicate") return <span className="key-badge key-badge--dup">✗ 중복</span>;
        return null;
    };

    return (
        <div className="scenario-container">
            <video autoPlay loop muted playsInline className="background-video">
                <source src="/vod/main_back2.mp4" type="video/mp4" />
            </video>
            <h1 className="title">교통 시뮬레이션 분석 시스템</h1>
            <p className="description">실제 교통 데이터를 바탕으로 시뮬레이션 결과를 분석하고 시나리오를 선택하세요.</p>

            <div className="card-container">
                {scenarioList?.map((scenario) => (
                    <div key={scenario.key} className="scenario-card" onClick={() => setScenario(scenario)}>
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
                        <p style={{ color: "#ccc", fontSize: "0.9rem", margin: "8px 0 20px" }}>
                            <strong style={{ color: "#fff" }}>{deleteConfirm.label}</strong> 시나리오를 삭제합니다.<br />
                            버전 데이터를 포함한 모든 정보가 삭제되며 복구할 수 없습니다.
                        </p>
                        <div className="scenario-form-actions">
                            <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-cancel">취소</button>
                            <button type="button" onClick={handleDelete} style={{ background: "rgba(220,60,60,0.25)", borderColor: "rgba(220,60,60,0.6)", color: "#f07070" }}>
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

                            {/* 키 — 생성 시만 편집 가능 */}
                            {modalMode === "create" ? (
                                <div className="scenario-form-row">
                                    <div className="scenario-form-label-row">
                                        <label>키 (고유값) *</label>
                                        {keyBadge()}
                                    </div>
                                    <input
                                        name="key"
                                        value={form.key}
                                        onChange={handleKeyChange}
                                        placeholder="영문자·숫자·밑줄만 사용 (예: SCENARIO_001)"
                                        autoComplete="off"
                                        className={
                                            keyStatus === "ok"        ? "input--ok"  :
                                            keyStatus === "duplicate" ? "input--err" : ""
                                        }
                                    />
                                    <span className="scenario-form-hint">영문자(A-Z, a-z), 숫자(0-9), 밑줄(_)만 입력 가능</span>
                                </div>
                            ) : (
                                <div className="scenario-form-row">
                                    <label>키 (고유값)</label>
                                    <input value={form.key} disabled style={{ opacity: 0.45 }} />
                                    <span className="scenario-form-hint">키는 변경할 수 없습니다.</span>
                                </div>
                            )}

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

                            {/* 중심점 */}
                            <div className="scenario-form-row">
                                <div className="scenario-form-coord-header">
                                    <label>중심점 (경도 / 위도)</label>
                                    <button type="button" className="btn-map-pick" onClick={() => setShowMapPicker(true)}>
                                        🗺 지도에서 선택
                                    </button>
                                </div>
                                <div className="scenario-form-row--half">
                                    <div>
                                        <input
                                            name="longitude"
                                            type="number"
                                            step="any"
                                            value={form.longitude}
                                            onChange={handleFormChange}
                                            placeholder="경도 (127.123)"
                                        />
                                    </div>
                                    <div>
                                        <input
                                            name="latitude"
                                            type="number"
                                            step="any"
                                            value={form.latitude}
                                            onChange={handleFormChange}
                                            placeholder="위도 (36.456)"
                                        />
                                    </div>
                                </div>
                                {form.longitude && form.latitude && (
                                    <p className="scenario-form-coord-preview">
                                        📍 {parseFloat(form.latitude).toFixed(5)}°N, {parseFloat(form.longitude).toFixed(5)}°E
                                    </p>
                                )}
                            </div>

                            {error && <p className="scenario-form-error">{error}</p>}

                            <div className="scenario-form-actions">
                                <button type="button" onClick={handleModalClose} className="btn-cancel">취소</button>
                                <button
                                    type="submit"
                                    disabled={submitting || (modalMode === "create" && (keyStatus === "duplicate" || keyStatus === "checking"))}
                                >
                                    {submitting ? "저장 중..." : modalMode === "edit" ? "수정" : "추가"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showMapPicker && (
                <MapRangePicker onSelect={handleMapSelect} onClose={() => setShowMapPicker(false)} />
            )}
        </div>
    );
};

export default ScenarioSelector;
