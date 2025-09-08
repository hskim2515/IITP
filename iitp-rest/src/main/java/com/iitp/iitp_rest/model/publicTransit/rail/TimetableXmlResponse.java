package com.iitp.iitp_rest.model.publicTransit.rail;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class TimetableXmlResponse {
    @XmlAttribute
    @XmlJavaTypeAdapter(DayOfWeekAdapter.class)
    private DayOfWeek dayOfWeek;
    @XmlAttribute
    private String lineId;
    @XmlAttribute
    private String time;
}
