import React, { useEffect, useState } from "react";
import { usePropertyStore } from "@stores/usePropertyStore";
import { findMenuByCode, useMenuStore } from "@stores/useMenuStore";
import { faClose } from "@fortawesome/free-solid-svg-icons/faClose";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit } from "@fortawesome/free-solid-svg-icons";
import { MenuTreeResponse } from "@type/openapi.gen";

function truncate(value: string, maxLength: number = 50): string {
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength) + '...';
}

const PropertyModal = () => {
    const selectedProps = usePropertyStore((state) => state.selectedProps);
    const [showViewer, setShowViewer] = useState<boolean | null>(false);
    const [subMenu, setSubMenu] = useState<MenuTreeResponse | null>(null);

    // subMenu 가 null 이 아닐 때만 보이게.
    // 가시화를 조정하는 것이 나을지, 아니면 컴포넌트를 제거하는 것이 나을지,

    const {
        activeSubmenu,
        menu,

        setActiveSubmenu,
    } = useMenuStore();

    useEffect(() => {
        const isValidProps =
            selectedProps &&
            typeof selectedProps === "object" &&
            Object.keys(selectedProps).length > 0;

        setShowViewer(isValidProps);
    }, [selectedProps]);

    useEffect(() => {
        if(menu) {
            setSubMenu(findMenuByCode(menu, 'NETWORK'))
        }
    }, [menu]);

    if (!selectedProps || Object.keys(selectedProps).length === 0) return null;
    if (!showViewer || activeSubmenu) return null;

    const onClickClose = () => {

    }

    const conClickEdit = () => {

    }

    return (
        <div style={styles.container}>
            <table style={styles.table}>
                <thead>
                <tr>
                    <th colSpan={2}>
                        <h2 style={{display: "contents"}}>{selectedProps?.featureType}</h2>
                        <FontAwesomeIcon className="close-btn" icon={faClose} onClick={() => setShowViewer(false)}/>
                        <FontAwesomeIcon className="edit-btn" icon={faEdit} onClick={() => {
                            if (selectedProps?.menuCode) {
                                setActiveSubmenu(subMenu);
                            }
                        }}/>
                    </th>
                </tr>
                <tr>
                    <th style={styles.th}>Property</th>
                    <th style={styles.th}>Value</th>
                </tr>
                </thead>
                <tbody>
                {Object.entries(selectedProps).map(([key, value]) => (
                    <tr key={key}>
                        <td style={styles.td}>{key}</td>
                        <td style={styles.td} title={String(value)}>
                            {Array.isArray(value)
                                ? `${value.length} (count)`
                                : typeof value === 'object'
                                    ? truncate(JSON.stringify(value), 60)
                                    : truncate(String(value), 60)}
                        </td>

                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
};

const styles = {
    container: {
        position: "fixed",
        bottom: "120px",
        left: "1300px",
        right: "5px",
        backgroundColor: "rgba(20, 20, 30, 0.95)", // 더 어두운 배경
        border: "1px solid rgba(255, 255, 255, 0.1)", // subtle 테두리
        borderRadius: "8px",
        padding: "16px",
        maxHeight: "30vh",
        overflowY: "auto",
        overflowX: "auto",
        zIndex: 2000,
        boxShadow: "0 0 12px rgba(0, 255, 255, 0.1)", // 네온 느낌
        color: "#e0e0e0", // 기본 텍스트 밝기
        backdropFilter: "blur(6px)", // 유리 느낌
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "13px",
        color: "#ccc",
    },
    th: {
        textAlign: "center",
        padding: "10px",
        backgroundColor: "rgba(30, 30, 45, 0.9)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        color: "#00ffff", // 시안 계열 포인트
        fontWeight: "600",
        fontSize: "12px",
    },
    td: {
        textAlign: "center",
        padding: "10px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        verticalAlign: "top",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        fontSize: "12px",
        color: "#e0e0e0",
    },
} as const;


export default PropertyModal;
