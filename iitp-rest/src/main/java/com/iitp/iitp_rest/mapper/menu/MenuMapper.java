package com.iitp.iitp_rest.mapper.menu;

import com.iitp.iitp_rest.config.GlobalMapperConfig;
import com.iitp.iitp_rest.model.menu.MenuRequest;
import com.iitp.iitp_rest.model.menu.MenuResponse;
import com.iitp.iitp_rest.model.menu.MenuTreeResponse;
import com.iitp.iitp_rest.model.menu.Menu;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import java.util.*;

@Mapper(config = GlobalMapperConfig.class)
public interface MenuMapper {

    @Mapping(target = "parents", ignore = true)
    @Mapping(target = "root", ignore = true)
    Menu toEntity(MenuRequest request);

    @Mapping(target = "parents", ignore = true)
    @Mapping(target = "root", ignore = true)
    Menu toEntityFromResponse(MenuResponse response);

    @Mapping(source = "parents.menuId", target = "parentsId")
    @Mapping(source = "root.menuId", target = "rootId")
    MenuResponse toResponse(Menu menu);

    List<MenuResponse> toResponseList(List<Menu> menuList);

    default List<MenuTreeResponse> toTreeResponse(List<Menu> menuList) {
        if (menuList == null || menuList.isEmpty()) {
            return Collections.emptyList();
        }

        Map<Long, MenuTreeResponse> idToDtoMap = new HashMap<>();
        List<MenuTreeResponse> rootNodes = new ArrayList<>();

        for (Menu menu : menuList) {
            MenuTreeResponse node = toTreeResponseNode(menu);
            if (node.getChildren() == null) node.setChildren(new ArrayList<>());
            idToDtoMap.put(node.getMenuId(), node);
        }

        for (Menu menu : menuList) {
            MenuTreeResponse node = idToDtoMap.get(menu.getMenuId());
            if (menu.getParents() != null) {
                MenuTreeResponse parentNode = idToDtoMap.get(menu.getParents().getMenuId());
                if (parentNode != null) {
                    if (parentNode.getChildren() == null) {
                        parentNode.setChildren(new ArrayList<>());
                    }
                    parentNode.getChildren().add(node);
                }
            } else {
                rootNodes.add(node);
            }
        }

        sortMenuTree(rootNodes);
        return rootNodes;
    }

    @Mapping(source = "root.menuId", target = "rootId")
    @Mapping(target = "children", ignore = true)
    MenuTreeResponse toTreeResponseNode(Menu menu);

    private void sortMenuTree(List<MenuTreeResponse> nodes) {
        if (nodes == null || nodes.isEmpty()) return;
        nodes.sort(Comparator.comparing(MenuTreeResponse::getSortOrder, Comparator.nullsLast(Integer::compareTo)));
        for (MenuTreeResponse node : nodes) {
            sortMenuTree(node.getChildren());
        }
    }
}
