package com.iitp.iitp_rest.model.network;

import lombok.Data;

import java.security.PublicKey;

@Data
public class PortData {
    public String type;
    public String linkId;
    public String direction;
}
