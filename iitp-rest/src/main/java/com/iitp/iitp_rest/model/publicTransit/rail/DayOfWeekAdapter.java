package com.iitp.iitp_rest.model.publicTransit.rail;

import com.iitp.iitp_rest.model.adapter.AbstractEnumAdapter;

public class DayOfWeekAdapter extends AbstractEnumAdapter<DayOfWeek, String> {
    public DayOfWeekAdapter() {
        super(DayOfWeek.class);
    }
}
