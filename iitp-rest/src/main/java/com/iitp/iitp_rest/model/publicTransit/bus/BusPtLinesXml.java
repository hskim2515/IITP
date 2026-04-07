package com.iitp.iitp_rest.model.publicTransit.bus;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Lines")
@XmlAccessorType(XmlAccessType.NONE)
public class BusPtLinesXml {

    @XmlElement(name = "Line")
    private List<LineXml> lines;

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class LineXml {
        @XmlAttribute
        private String id;
        @XmlAttribute
        private Integer interval;

        @XmlElement(name = "link")
        private SeqXml link;
        @XmlElement(name = "node")
        private SeqXml node;
        @XmlElement(name = "station")
        private SeqXml station;
        @XmlElement(name = "garage")
        private SeqXml garage;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class SeqXml {
        @XmlAttribute
        private String seq;
    }
}
