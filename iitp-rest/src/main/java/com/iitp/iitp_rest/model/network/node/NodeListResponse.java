package com.iitp.iitp_rest.model.network.node;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class NodeListResponse {
    private List<NodeResponse> nodes;
}
