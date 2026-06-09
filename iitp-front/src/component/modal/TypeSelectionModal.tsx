import React, { useState } from "react";
import { typeOptionsMap, typeImageMap } from "../../config/menuDrawConfig";
import { useTypeSelectStore } from "@stores/useTypeSelectStore";
import { buildFileUrl } from "@utils/fileUrl";
import style from "@css/TypeSelectModal.module.css";

const TypeSelectModal = () => {
    const { typeKey, onConfirm, close } = useTypeSelectStore();
    const options = typeKey ? (typeOptionsMap[typeKey] ?? []) : [];
    const images = typeKey ? (typeImageMap[typeKey] ?? {}) : {};
    const [selected, setSelected] = useState<string>("");

    React.useEffect(() => {
        setSelected(options[0] ?? "");
    }, [typeKey]);

    if (!typeKey) return null;

    const handleConfirm = () => {
        if (onConfirm) onConfirm(selected);
        close();
    };

    return (
        <div className={style.overlay}>
            <div className={style.container}>
                <div className={style.header}>노면 표시 타입 선택</div>
                <div className={style.content}>
                    <div className={style.cardGrid}>
                        {options.map((opt) => (
                            <button
                                key={opt}
                                className={`${style.card} ${selected === opt ? style.cardSelected : ""}`}
                                onClick={() => setSelected(opt)}
                            >
                                {images[opt] ? (
                                    <img
                                        src={buildFileUrl(images[opt])}
                                        alt={opt}
                                        className={style.cardImage}
                                        onError={(e) => {
                                            (e.currentTarget as HTMLImageElement).style.display = "none";
                                        }}
                                    />
                                ) : (
                                    <div className={style.cardImagePlaceholder} />
                                )}
                                <span className={style.cardLabel}>{opt}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className={style.actions}>
                    <button className={style.btn} onClick={close}>취소</button>
                    <button className={style.btnConfirm} onClick={handleConfirm}>확인</button>
                </div>
            </div>
        </div>
    );
};

export default TypeSelectModal;