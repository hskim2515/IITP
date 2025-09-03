package com.iitp.iitp_rest.model.network;

import com.fasterxml.jackson.annotation.JsonManagedReference;
import com.iitp.iitp_rest.model.network.link.Link;
import com.iitp.iitp_rest.model.network.node.Node;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@EntityListeners(AuditingEntityListener.class)
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
@Table(indexes = {
        @Index(name = "network_name_idx", columnList = "name", unique = true)
})
@Entity
public class Network {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true)
    private String name;
    @Builder.Default
    @OneToMany(mappedBy = "network", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Node> nodes = new ArrayList<>();
    @Builder.Default
    @OneToMany(mappedBy = "network", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JsonManagedReference
    private List<Link> links = new ArrayList<>();

    @CreatedDate
    @Column(name = "insert_date", nullable = false)
    private LocalDateTime insertDate;
    @LastModifiedDate
    @Column(name = "modify_date")
    private LocalDateTime modifyDate;

    public void addNode(Node node) {
        this.nodes.add(node);
        node.setNetwork(this);
    }

    public void addLink(Link link) {
        this.links.add(link);
        link.setNetwork(this);
    }
}
