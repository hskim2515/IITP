import React, { useState } from 'react';
import { useMenuStore } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/Header.module.css";

interface Props {
    title: string;
    items: MenuTreeResponse[];
}

const DropdownMenu = ({title, items}: Props) => {

    const [isOpen, setIsOpen] = useState(false);

    const {setActiveDropdownMenu} = useMenuStore(useShallow((state) => ({
        setActiveDropdownMenu: state.setActiveDropdownMenu,
    })));

    return (
        <div
            className={styles.container}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            <span className={styles['title']}>{title}</span>
            {isOpen && (
                <div className={styles['dropdown']}>
                    {items.map((item) => (
                        <div
                            key={item.menuId}
                            className={styles['item']}
                            onClick={() => {
                                setActiveDropdownMenu(item);
                            }}
                        >
                            {item.nameKor}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default DropdownMenu;