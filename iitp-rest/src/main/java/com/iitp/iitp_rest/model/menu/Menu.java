package com.iitp.iitp_rest.model.menu;


import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;
import java.time.LocalDateTime;
import java.util.List;

@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
@ToString(exclude = {"children", "parents"})
@Builder(toBuilder = true)
public class Menu {
    /** 메뉴 ID */
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "menu_seq")
    @SequenceGenerator(name = "menu_seq", sequenceName = "menu_id_sequence", allocationSize = 50)
    private Long menuId;

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

    /** 메뉴 깊이 */
    private Integer depth;

    /** 메뉴 정렬 순서 */
    private Integer sortOrder;

    /** 메뉴 활성화 여부 */
    private Character available;

    /** 등록일: 생성 시 자동 저장 */
    @CreationTimestamp
    private LocalDateTime insertDate;

    /** 수정일: 업데이트 시 자동 갱신 */
    @UpdateTimestamp
    private LocalDateTime updateDate;
}
