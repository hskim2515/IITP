
package com.iitp.iitp_rest.model.network.cell;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class CellTreeResponse {
    private Long laneId;
    private Long id;
    private double length;
    private double offset;

    public CellTreeResponse(Long laneId, Long id, double length, double offset) {
        this.laneId = laneId;
        this.id = id;
        this.length = length;
        this.offset = offset;
    }
}

