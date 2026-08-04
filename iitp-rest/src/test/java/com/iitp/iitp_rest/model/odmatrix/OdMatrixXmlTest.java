package com.iitp.iitp_rest.model.odmatrix;

import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Marshaller;
import com.iitp.iitp_rest.service.xmllayer.XmlLayerConverter;
import org.junit.jupiter.api.Test;

import java.io.StringReader;
import java.io.StringWriter;

import static org.assertj.core.api.Assertions.assertThat;

class OdMatrixXmlTest {

    private static final String XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <Demands>
              <odMatrix id="0" startTime="00:00:00" duration="60">
                <avodMatrix>
                  <demand source="11000403" sink="11000404" flow="20" dist=""/>
                </avodMatrix>
                <nvodMatrix>
                  <demand source="11000403" sink="11000404" flow="80" dist=""/>
                </nvodMatrix>
              </odMatrix>
            </Demands>
            """;

    @Test
    void parsesAndWritesBothNextSimVehicleDemandMatrices() throws Exception {
        JAXBContext context = JAXBContext.newInstance(OdMatrixXml.class);
        OdMatrixXml parsed = (OdMatrixXml) context.createUnmarshaller().unmarshal(new StringReader(XML));

        var matrix = parsed.getOdMatrices().get(0);
        assertThat(matrix.getAvodMatrix().getDemands()).singleElement()
                .satisfies(demand -> assertThat(demand.getFlow()).isEqualTo(20.0));
        assertThat(matrix.getNvodMatrix().getDemands()).singleElement()
                .satisfies(demand -> assertThat(demand.getFlow()).isEqualTo(80.0));

        StringWriter output = new StringWriter();
        Marshaller marshaller = context.createMarshaller();
        marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
        marshaller.marshal(parsed, output);

        String saved = output.toString();
        assertThat(saved).contains("<avodMatrix>", "<nvodMatrix>");
        assertThat(saved.indexOf("<avodMatrix>")).isLessThan(saved.indexOf("<nvodMatrix>"));
        assertThat(saved).doesNotContain("nvRatio", "avRatio", "vehicleTypeId", "vehType=");
    }

    @Test
    void mapRoundTripKeepsBothDemandMatricesForEditorSave() throws Exception {
        JAXBContext context = JAXBContext.newInstance(OdMatrixXml.class);
        OdMatrixXml parsed = (OdMatrixXml) context.createUnmarshaller().unmarshal(new StringReader(XML));

        OdMatrixXml restored = XmlLayerConverter.fromMap(XmlLayerConverter.toMap(parsed), OdMatrixXml.class);

        assertThat(restored.getOdMatrices().get(0).getAvodMatrix().getDemands())
                .extracting(OdMatrixXml.DemandXml::getFlow)
                .containsExactly(20.0);
        assertThat(restored.getOdMatrices().get(0).getNvodMatrix().getDemands())
                .extracting(OdMatrixXml.DemandXml::getFlow)
                .containsExactly(80.0);
    }
}
