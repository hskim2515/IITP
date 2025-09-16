package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NetworkResponse {
    private String name;
    private Long id;
    private List<NodeResponse> nodes = new ArrayList<>();
    private List<LinkResponse> links = new ArrayList<>();
}
