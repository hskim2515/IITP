package com.iitp.iitp_rest.model.odmatrix;

import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Demands")
@XmlAccessorType(XmlAccessType.NONE)
public class OdMatrixXml {

    @XmlElement(name = "odMatrix")
    private List<OdMatrixItemXml> odMatrices;

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    @XmlType(propOrder = {"avodMatrix", "nvodMatrix"})
    public static class OdMatrixItemXml {
        @XmlAttribute
        private Integer id;

        @XmlAttribute
        private String startTime;

        @XmlAttribute
        private Integer duration;

        @XmlElement(name = "avodMatrix")
        private AvOdMatrixXml avodMatrix;

        @XmlElement(name = "nvodMatrix")
        private NvOdMatrixXml nvodMatrix;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class AvOdMatrixXml {
        @XmlElement(name = "demand")
        private List<DemandXml> demands;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class NvOdMatrixXml {
        @XmlElement(name = "demand")
        private List<DemandXml> demands;
    }

    @Data
    @XmlAccessorType(XmlAccessType.NONE)
    public static class DemandXml {
        @XmlAttribute
        private String source;

        @XmlAttribute
        private String sink;

        @XmlAttribute
        private Double flow;

        @XmlAttribute
        private String dist;
    }
}
