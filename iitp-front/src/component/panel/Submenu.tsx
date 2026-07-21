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

  const submenuData: MenuTreeResponse[] | undefined = activeDropdownMenu.children?.filter(
      (item) => item.available !== 'N'
  );

  // propertyFormSchema 없이도 전용 세션을 여는 메뉴 코드 목록
  // (KTDB/OSM/NETWORK 임포트는 FileImportModal(헤더 파일>가져오기)로 통합되어 제거)
  const MODAL_MENU_CODES = new Set(['OD_MATRIX', 'PASSENGER']);

  const handleClickSubmenu = (item: MenuTreeResponse) => {
    if(!item.menuCode) return
    if (propertyFormSchema[item.menuCode] || MODAL_MENU_CODES.has(item.menuCode)) {
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