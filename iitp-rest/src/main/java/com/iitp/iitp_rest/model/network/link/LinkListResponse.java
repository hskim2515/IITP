package com.iitp.iitp_rest.model.network.link;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class LinkListResponse {
    private List<LinkResponse> links;
}
