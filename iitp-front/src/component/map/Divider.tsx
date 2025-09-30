import React from "react";
import styles from "@css/Maps.module.css"
interface Props {
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}
const Divider = ({onMouseDown}:Props) => {
    return (
        <div
            onMouseDown={onMouseDown}
            className={styles.divider}
        />
    )
}

export default Divider;