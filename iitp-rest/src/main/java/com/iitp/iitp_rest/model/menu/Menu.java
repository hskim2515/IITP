package com.iitp.iitp_rest.model.menu;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iitp.iitp_rest.model.BaseEntity;
import com.iitp.iitp_rest.model.role.Role;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;
import java.util.List;

@EqualsAndHashCode(callSuper = true)
@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
@ToString(exclude = {"children", "parents"})
@Builder(toBuilder = true)
public class Menu extends BaseEntity {
    /** 메뉴 ID */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long menuId;

    /** 메뉴 코드 */
    @Column(nullable = false)
    private String menuCode;

    /** 메뉴 언어 */
    private String language;

    /** 한글 메뉴 명 */
    private String nameKor;

    /** 영어 메뉴 명 */
    private String nameEn;

    /**
     * 부모 메뉴와의 자기참조 연관관계
     * 부모 메뉴가 삭제되면, 자식 메뉴의 부모 참조를 null로 처리한다.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parents_id")
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private Menu parents;

    @OneToMany(mappedBy = "parents", fetch = FetchType.LAZY)
    @JsonIgnore
    private List<Menu> children;

    /**
     * 루트 메뉴와의 자기참조 연관관계
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "root_id")
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private Menu root;

    /** 메뉴 깊이 */
    private Integer depth;

    /** 메뉴 정렬 순서 */
    private Integer sortOrder;

    /** 메뉴 활성화 여부 */
    private String available;

    /** 메뉴 접근 권한 */
    /** 메뉴 접근 권한 (ENUM으로 매핑하되, DB에는 문자열로 저장) */
    @Enumerated(EnumType.STRING)
    @Column(name = "access_role", length = 20)
    private Role accessRole;
}
