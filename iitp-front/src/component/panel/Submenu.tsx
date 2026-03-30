import React, { useEffect } from "react";
import { useMenuStore } from "@stores/useMenuStore";
import { MenuTreeResponse } from "@type/openapi.gen";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import styles from "@css/Submenu.module.css"
import {useWorkflowStore} from "@stores/useWorkflowStore";

const Submenu = () => {
  const {
    activeDropdownMenu,
    activeSubmenu,
    setActiveSubmenu,
  } = useMenuStore();

  const { openSession } = useWorkflowStore();

  useEffect(() => {
    if(!activeDropdownMenu) return
  }, [activeDropdownMenu]);

  if (!activeDropdownMenu) return null;

  const submenuData: MenuTreeResponse[] | undefined = activeDropdownMenu.children;

  const handleClickSubmenu = (item: MenuTreeResponse) => {
    if(!item.menuCode) return
    if (propertyFormSchema[item.menuCode]) {
      setActiveSubmenu(item);
      openSession(item);
    } else {
      setActiveSubmenu(null);
    }
  };

  return (
      <div>
        {submenuData && submenuData.map((item) => (
            <p
                key={item.menuId}
                onClick={() => handleClickSubmenu(item)}
                className={`${styles['item']} ${activeSubmenu?.menuId === item.menuId ? styles['itemActive'] : ''}`}
            >
              {item.nameKor}
            </p>
        ))}
      </div>
  )
}
export default Submenu;