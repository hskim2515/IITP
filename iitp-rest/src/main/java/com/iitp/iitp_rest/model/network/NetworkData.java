package com.iitp.iitp_rest.model.network;

import lombok.Data;

import java.util.List;

@Data
public class NetworkData {
    public List<NodeData> nodes;
    public List<LinkData> links;
}
