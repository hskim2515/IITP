package com.iitp.iitp_rest.model.publicTransit.rail;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.publicTransit.StationType;
import com.iitp.iitp_rest.model.publicTransit.StationTypeAdapter;
import com.iitp.iitp_rest.model.publicTransit.TransitMode;
import com.iitp.iitp_rest.model.publicTransit.TransitModeAdapter;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class RailStationXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    @XmlJavaTypeAdapter(TransitModeAdapter.class)
    private TransitMode transitMode = TransitMode.subway;
    @XmlAttribute
    private String lineList;
    @XmlAttribute
    @XmlJavaTypeAdapter(StationTypeAdapter.class)
    private StationType type;
    @XmlAttribute
    private String address;
    // NextSim 실제 배포판 예시(bucheon railStation.xml 활성 블록)는 address 가 아니라 name
    // 속성을 사용한다 — 우리 편집 화면/DB는 계속 address 로 관리하고, SFTP 동기화 시점에
    // address 값을 name 에도 채워 실제 NextSim 파서가 기대하는 속성명을 맞춘다.
    @XmlAttribute
    private String name;
    @XmlAttribute
    private String center;
    @XmlElement(name = "exit")
    private List<ExitXml> exits = new ArrayList<>();
//    @XmlElement(name = "timetable")
    @XmlTransient
    private List<TimetableXml> timetables = new ArrayList<>();
    @XmlTransient
    private Coordinates coordinates;
}
