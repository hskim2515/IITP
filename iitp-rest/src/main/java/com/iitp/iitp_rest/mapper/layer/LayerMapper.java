package com.iitp.iitp_rest.mapper.layer;

import com.iitp.iitp_rest.config.GlobalMapperConfig;
import com.iitp.iitp_rest.model.layer.LayerGroupResponse;
import com.iitp.iitp_rest.model.layer.LayerResponse;
import com.iitp.iitp_rest.model.layer.Layer;
import com.iitp.iitp_rest.model.layer.LayerGroup;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import java.util.List;

@Mapper(config = GlobalMapperConfig.class)
public interface LayerMapper {

    @Mapping(source = "group.key", target = "groupKey")
    LayerResponse toResponse(Layer layer);

    List<LayerResponse> toResponseList(List<Layer> layers);

    LayerGroupResponse toGroupResponse(LayerGroup layerGroup);

    List<LayerGroupResponse> toGroupResponseList(List<LayerGroup> layerGroups);
}