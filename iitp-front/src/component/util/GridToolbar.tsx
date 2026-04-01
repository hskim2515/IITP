import React from "react";
import { useNavigationStore } from "@stores/useNavigationStore";
import style from "@css/GridToolbar.module.css";
import {useSelectionStore} from "@stores/useSelectionStore";

type GridToolbarProps = {
    onAdd: () => void;
    onDelete: () => void;
    onSave: () => void;
    rootKeys?: string[];
    activeRootKey?: string;
    onRootChange?: (key: string) => void;
};

export const GridToolbar = ({
                                onAdd, onDelete, onSave,
                                rootKeys = [], activeRootKey, onRootChange
                            }: GridToolbarProps) => {
    const stack = useNavigationStore((s) => s.stack);
    const goTo = useNavigationStore((s) => s.goTo);
    const clearSelected = useSelectionStore((s) => s.clearSelected);
    const frame = stack[stack.length - 1];

    if (!frame) return null;

    const handleGoTo = (index: number) => {
        clearSelected();
        goTo(index);
    };

    const handleRootChange = (key: string) => {
        if (key !== activeRootKey && onRootChange) {
            clearSelected();
            onRootChange(key);
        }
    };

    const rowCount = frame.rows.length;
    const hasSwitcher = rootKeys.length > 0;
    const isMultiTab = rootKeys.length > 1;
    const canGoBack = stack.length > 1;

    return (
        <div className={style.toolbar}>
            <div className={style.navSection}>

                {/* 루트 타입 탭 */}
                {hasSwitcher && (
                    <div className={style.switcher}>
                        {rootKeys.map((key) => (
                            <button
                                key={key}
                                className={`${style.switchBtn} ${key === activeRootKey ? style.active : ""} ${!isMultiTab ? style.singleTab : ""}`}
                                onClick={() => isMultiTab && handleRootChange(key)}
                            >
                                {key.toUpperCase()}
                            </button>
                        ))}
                    </div>
                )}

                {/* 뒤로 가기 버튼 — 드릴다운 중일 때만 표시 */}
                {canGoBack && (
                    <button
                        className={style.backBtn}
                        onClick={() => handleGoTo(stack.length - 2)}
                        title={`${stack[stack.length - 2]?.levelName ?? "상위"} 레벨로 돌아가기`}
                    >
                        <span className={style.backIcon}>‹</span>
                        <span className={style.backLabel}>
                            {stack[stack.length - 2]?.levelName?.toUpperCase() ?? "상위"}
                        </span>
                    </button>
                )}

                {/* 브레드크럼 */}
                <ol className={style.list}>
                    {stack.map((f, index) => {
                        const isLast = index === stack.length - 1;
                        const isRoot = index === 0;

                        if (hasSwitcher && isRoot) {
                            if (isLast) {
                                return (
                                    <li key={index} className={style.item}>
                                        <span className={style.rowCount}>{rowCount}개</span>
                                    </li>
                                );
                            }
                            return null;
                        }

                        return (
                            <li key={index} className={style.item}>
                                {isLast ? (
                                    <div className={style.activeBreadcrumb}>
                                        {/* 현재 레벨 타입 뱃지 */}
                                        <span className={style.currentLevelName}>
                                            {f.levelName.toUpperCase()}
                                        </span>
                                        {/* 부모 컨텍스트: "links #20001516" */}
                                        {f.breadLabel && f.breadLabel !== f.levelName && (
                                            <span className={style.currentLabel}>
                                                {f.breadLabel}
                                            </span>
                                        )}
                                        <span className={style.rowCount}>{rowCount}개</span>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            className={`${style.crumb} ${style.crumbLink}`}
                                            onClick={() => handleGoTo(index)}
                                            title={`${f.levelName} 레벨로 이동`}
                                        >
                                            {isRoot ? f.levelName.toUpperCase() : f.breadLabel}
                                        </button>
                                        <span className={style.sep} aria-hidden>›</span>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </div>

            <div className={style.actionSection}>
                <button className={style.btnAdd} onClick={onAdd}>+ 추가</button>
                <button className={style.btnDelete} onClick={onDelete}>− 삭제</button>
                <button className={style.btnSave} onClick={onSave}>저장</button>
            </div>
        </div>
    );
};