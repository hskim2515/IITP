package com.iitp.iitp_rest.mapper.layer;

import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.layer.LayerGroup;
import com.iitp.iitp_rest.model.layer.LayerGroupResponse;
import com.iitp.iitp_rest.model.layer.LayerResponse;
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
public class LayerMapperImpl implements LayerMapper {

    @Override
    public LayerResponse toResponse(Layer layer) {
        if ( layer == null ) {
            return null;
        }

        LayerResponse layerResponse = new LayerResponse();

        String key = layerGroupKey( layer );
        if ( key != null ) {
            layerResponse.setGroupKey( key );
        }
        if ( layer.getId() != null ) {
            layerResponse.setId( layer.getId() );
        }
        if ( layer.getKey() != null ) {
            layerResponse.setKey( layer.getKey() );
        }
        if ( layer.getLabel() != null ) {
            layerResponse.setLabel( layer.getLabel() );
        }
        layerResponse.setBasic( layer.isBasic() );
        layerResponse.setAuth( layer.getAuth() );
        if ( layer.getFormType() != null ) {
            layerResponse.setFormType( layer.getFormType() );
        }
        if ( layer.getUrl() != null ) {
            layerResponse.setUrl( layer.getUrl() );
        }

        return layerResponse;
    }

    @Override
    public List<LayerResponse> toResponseList(List<Layer> layers) {
        if ( layers == null ) {
            return new ArrayList<LayerResponse>();
        }

        List<LayerResponse> list = new ArrayList<LayerResponse>( layers.size() );
        for ( Layer layer : layers ) {
            list.add( toResponse( layer ) );
        }

        return list;
    }

    @Override
    public LayerGroupResponse toGroupResponse(LayerGroup layerGroup) {
        if ( layerGroup == null ) {
            return null;
        }

        LayerGroupResponse layerGroupResponse = new LayerGroupResponse();

        if ( layerGroup.getId() != null ) {
            layerGroupResponse.setId( layerGroup.getId() );
        }
        if ( layerGroup.getKey() != null ) {
            layerGroupResponse.setKey( layerGroup.getKey() );
        }
        if ( layerGroup.getLabel() != null ) {
            layerGroupResponse.setLabel( layerGroup.getLabel() );
        }
        List<LayerResponse> list = toResponseList( layerGroup.getLayers() );
        if ( list != null ) {
            layerGroupResponse.setLayers( list );
        }

        return layerGroupResponse;
    }

    @Override
    public List<LayerGroupResponse> toGroupResponseList(List<LayerGroup> layerGroups) {
        if ( layerGroups == null ) {
            return new ArrayList<LayerGroupResponse>();
        }

        List<LayerGroupResponse> list = new ArrayList<LayerGroupResponse>( layerGroups.size() );
        for ( LayerGroup layerGroup : layerGroups ) {
            list.add( toGroupResponse( layerGroup ) );
        }

        return list;
    }

    private String layerGroupKey(Layer layer) {
        LayerGroup group = layer.getGroup();
        if ( group == null ) {
            return null;
        }
        return group.getKey();
    }
}
