import React, { useState } from 'react';
import { useMenuStore } from "@stores/useMenuStore";
import { useShallow } from "zustand/react/shallow";
import { MenuTreeResponse } from "@type/openapi.gen";
import styles from "@css/Header.module.css";

interface Props {
    title: string;
    items: MenuTreeResponse[];
    onItemClick?: (item: MenuTreeResponse) => void;
}

const DropdownMenu = ({title, items, onItemClick}: Props) => {

    const [isOpen, setIsOpen] = useState(false);

    const {setActiveDropdownMenu} = useMenuStore(useShallow((state) => ({
        setActiveDropdownMenu: state.setActiveDropdownMenu,
    })));

    const handleClick = (item: MenuTreeResponse) => {
        if (onItemClick) {
            onItemClick(item);
        } else {
            setActiveDropdownMenu(item);
        }
        setIsOpen(false);
    };

    return (
        <div
            className={styles.container}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            <span className={`${styles['title']} ${isOpen ? styles['titleActive'] : ''}`}>{title}</span>
            {isOpen && (
                <div className={styles['dropdown']}>
                    {items.map((item) => (
                        <div
                            key={item.menuId}
                            className={styles['item']}
                            onClick={() => handleClick(item)}
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
