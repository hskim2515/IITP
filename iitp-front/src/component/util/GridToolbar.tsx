import React, { useMemo } from "react";
import { useCanGoBack, useCurrentFrame, useNavigationStore } from "@stores/useNavigationStore";
import style from "@css/GridToolbar.module.css";

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
    const frame = useCurrentFrame();
    if (!frame) return null;

    const stack = useNavigationStore((s) => s.stack);
    const pop = useNavigationStore((s) => s.pop);
    const goTo = useNavigationStore((s) => s.goTo);
    const canGoBack = useCanGoBack();
    const rowCount = frame.rows.length;

    return (
        <div className={style.toolbar}>
            <div className={style.navSection}>
                {canGoBack && (
                    <button className={style.back} onClick={pop}>← 뒤로</button>
                )}

                <ol className={style.list}>
                    {stack.map((f, index) => {
                        const isLast = index === stack.length - 1;
                        const isRoot = index === 0;

                        return (
                            <li key={index} className={style.item}>
                                {isLast ? (
                                    <div className={style.activeBreadcrumb}>
                                        {isRoot && rootKeys.length > 1 ? (
                                            <div className={style.switcher}>
                                                {rootKeys.map((key) => (
                                                    <button
                                                        key={key}
                                                        className={`${style.switchBtn} ${activeRootKey === key ? style.active : ""}`}
                                                        onClick={() => onRootChange?.(key)}
                                                    >
                                                        {key.toUpperCase()}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className={`${style.crumb} ${style.crumbActive}`}>
                                                {(isRoot ? activeRootKey : f.breadLabel)?.toUpperCase()}
                                            </span>
                                        )}
                                        <span className={style.rowCount}>{rowCount}개</span>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            className={`${style.crumb} ${style.crumbLink}`}
                                            onClick={() => goTo(index)}
                                        >
                                            {f.breadLabel.toUpperCase()}
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
                <div className={style.right}>
                    <button className={style.btnAdd} onClick={onAdd}>+ 추가</button>
                    <button className={style.btnDelete} onClick={onDelete}>− 삭제</button>
                    <button className={style.btnSave} onClick={onSave}>저장</button>
                </div>
            </div>
        </div>
    );
};