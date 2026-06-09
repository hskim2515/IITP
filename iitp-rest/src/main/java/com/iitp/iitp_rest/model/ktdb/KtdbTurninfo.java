package com.iitp.iitp_rest.model.ktdb;

import jakarta.persistence.*;
import lombok.Getter;

@Getter
@Entity
@Table(name = "ktdb_turninfo")
public class KtdbTurninfo {

    @EmbeddedId
    private KtdbTurninfoPk id;

    @Column(name = "turn_type", length = 10)
    private String turnType;

    @Column(name = "turn_oper", length = 1, nullable = false)
    private String turnOper;

    public String getNodeId()  { return id.getNodeId(); }
    public String getStLink()  { return id.getStLink(); }
    public String getEdLink()  { return id.getEdLink(); }
    public boolean isProhibited() { return "1".equals(turnOper); }
}
