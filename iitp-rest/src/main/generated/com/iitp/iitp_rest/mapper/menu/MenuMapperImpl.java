package com.iitp.iitp_rest.mapper.menu;

import com.iitp.iitp_rest.model.menu.Menu;
import com.iitp.iitp_rest.model.menu.MenuRequest;
import com.iitp.iitp_rest.model.menu.MenuResponse;
import com.iitp.iitp_rest.model.menu.MenuTreeResponse;
import java.util.ArrayList;
import java.util.List;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-03-09T09:09:23+0900",
    comments = "version: 1.6.3, compiler: javac, environment: Java 23.0.2 (Amazon.com Inc.)"
)
@Component
public class MenuMapperImpl implements MenuMapper {

    @Override
    public Menu toEntity(MenuRequest request) {
        if ( request == null ) {
            return null;
        }

        Menu.MenuBuilder menu = Menu.builder();

        if ( request.getMenuId() != null ) {
            menu.menuId( request.getMenuId() );
        }
        if ( request.getMenuCode() != null ) {
            menu.menuCode( request.getMenuCode() );
        }
        if ( request.getLanguage() != null ) {
            menu.language( request.getLanguage() );
        }
        if ( request.getNameKor() != null ) {
            menu.nameKor( request.getNameKor() );
        }
        if ( request.getNameEn() != null ) {
            menu.nameEn( request.getNameEn() );
        }
        if ( request.getDepth() != null ) {
            menu.depth( request.getDepth() );
        }
        if ( request.getSortOrder() != null ) {
            menu.sortOrder( request.getSortOrder() );
        }
        if ( request.getAvailable() != null ) {
            menu.available( request.getAvailable().toString() );
        }
        if ( request.getAccessRole() != null ) {
            menu.accessRole( request.getAccessRole() );
        }

        return menu.build();
    }

    @Override
    public Menu toEntityFromResponse(MenuResponse response) {
        if ( response == null ) {
            return null;
        }

        Menu.MenuBuilder menu = Menu.builder();

        if ( response.getMenuId() != null ) {
            menu.menuId( response.getMenuId() );
        }
        if ( response.getMenuCode() != null ) {
            menu.menuCode( response.getMenuCode() );
        }
        if ( response.getLanguage() != null ) {
            menu.language( response.getLanguage() );
        }
        if ( response.getNameKor() != null ) {
            menu.nameKor( response.getNameKor() );
        }
        if ( response.getNameEn() != null ) {
            menu.nameEn( response.getNameEn() );
        }
        if ( response.getDepth() != null ) {
            menu.depth( response.getDepth() );
        }
        if ( response.getSortOrder() != null ) {
            menu.sortOrder( response.getSortOrder() );
        }
        if ( response.getAvailable() != null ) {
            menu.available( response.getAvailable().toString() );
        }
        if ( response.getAccessRole() != null ) {
            menu.accessRole( response.getAccessRole() );
        }

        return menu.build();
    }

    @Override
    public MenuResponse toResponse(Menu menu) {
        if ( menu == null ) {
            return null;
        }

        MenuResponse menuResponse = new MenuResponse();

        Long menuId = menuParentsMenuId( menu );
        if ( menuId != null ) {
            menuResponse.setParentsId( menuId );
        }
        Long menuId1 = menuRootMenuId( menu );
        if ( menuId1 != null ) {
            menuResponse.setRootId( menuId1 );
        }
        if ( menu.getMenuId() != null ) {
            menuResponse.setMenuId( menu.getMenuId() );
        }
        if ( menu.getMenuCode() != null ) {
            menuResponse.setMenuCode( menu.getMenuCode() );
        }
        if ( menu.getLanguage() != null ) {
            menuResponse.setLanguage( menu.getLanguage() );
        }
        if ( menu.getNameKor() != null ) {
            menuResponse.setNameKor( menu.getNameKor() );
        }
        if ( menu.getNameEn() != null ) {
            menuResponse.setNameEn( menu.getNameEn() );
        }
        if ( menu.getDepth() != null ) {
            menuResponse.setDepth( menu.getDepth() );
        }
        if ( menu.getSortOrder() != null ) {
            menuResponse.setSortOrder( menu.getSortOrder() );
        }
        if ( menu.getAvailable() != null ) {
            menuResponse.setAvailable( menu.getAvailable().charAt( 0 ) );
        }
        if ( menu.getAccessRole() != null ) {
            menuResponse.setAccessRole( menu.getAccessRole() );
        }

        return menuResponse;
    }

    @Override
    public List<MenuResponse> toResponseList(List<Menu> menuList) {
        if ( menuList == null ) {
            return new ArrayList<MenuResponse>();
        }

        List<MenuResponse> list = new ArrayList<MenuResponse>( menuList.size() );
        for ( Menu menu : menuList ) {
            list.add( toResponse( menu ) );
        }

        return list;
    }

    @Override
    public MenuTreeResponse toTreeResponseNode(Menu menu) {
        if ( menu == null ) {
            return null;
        }

        MenuTreeResponse menuTreeResponse = new MenuTreeResponse();

        Long menuId = menuRootMenuId( menu );
        if ( menuId != null ) {
            menuTreeResponse.setRootId( menuId );
        }
        if ( menu.getMenuId() != null ) {
            menuTreeResponse.setMenuId( menu.getMenuId() );
        }
        if ( menu.getMenuCode() != null ) {
            menuTreeResponse.setMenuCode( menu.getMenuCode() );
        }
        if ( menu.getLanguage() != null ) {
            menuTreeResponse.setLanguage( menu.getLanguage() );
        }
        if ( menu.getNameKor() != null ) {
            menuTreeResponse.setNameKor( menu.getNameKor() );
        }
        if ( menu.getNameEn() != null ) {
            menuTreeResponse.setNameEn( menu.getNameEn() );
        }
        if ( menu.getDepth() != null ) {
            menuTreeResponse.setDepth( menu.getDepth() );
        }
        if ( menu.getSortOrder() != null ) {
            menuTreeResponse.setSortOrder( menu.getSortOrder() );
        }
        if ( menu.getAvailable() != null ) {
            menuTreeResponse.setAvailable( menu.getAvailable().charAt( 0 ) );
        }
        if ( menu.getAccessRole() != null ) {
            menuTreeResponse.setAccessRole( menu.getAccessRole() );
        }

        return menuTreeResponse;
    }

    private Long menuParentsMenuId(Menu menu) {
        Menu parents = menu.getParents();
        if ( parents == null ) {
            return null;
        }
        return parents.getMenuId();
    }

    private Long menuRootMenuId(Menu menu) {
        Menu root = menu.getRoot();
        if ( root == null ) {
            return null;
        }
        return root.getMenuId();
    }
}
