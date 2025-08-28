create table layer_schema
(
    id         bigserial
        primary key,
    name       varchar(255) not null,
    sort_order integer      not null,
    status     varchar(255) not null
        constraint layer_schema_status_check
            check ((status)::text = ANY
                   (ARRAY [('ACTIVE'::character varying)::text, ('INACTIVE'::character varying)::text, ('DELETED'::character varying)::text])),
    layer_id   bigint
        constraint fk1nxldm8wy7q7bjgffrdhc67v6
            references layer
);

alter table layer_schema
    owner to postgres;

INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (1, 'links', 10, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (4, 'nodes', 0, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (3, 'ports', 1, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (7, 'cells', 12, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (5, 'segments', 13, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (2, 'connections', 2, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (6, 'lanes', 11, 'ACTIVE', 7);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (8, 'busStations', 0, 'ACTIVE', 9);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (10, 'exits', 0, 'ACTIVE', 13);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (9, 'railStations', 0, 'ACTIVE', 13);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (11, 'vehType', 0, 'ACTIVE', null);
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (12, 'pavementMarkings', 0, 'ACTIVE', 22);

create table layer_schema_config
(
    id         bigserial
        primary key,
    config_key varchar(255) not null,
    input_type varchar(255) not null,
    sort_order integer      not null
);

alter table layer_schema_config
    owner to postgres;

INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (1, 'name', 'text', 1);
INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (3, 'readOnly', 'select', 3);
INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (4, 'nullable', 'select', 4);
INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (5, 'status', 'select', 5);
INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (2, 'inputType', 'select', 2);
INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (6, 'options', 'tags', 6);

create table layer_schema_config_option
(
    id            bigserial
        primary key,
    value         varchar(255),
    definition_id bigint
        constraint fkln4jdespbgc14o6evuxhgv0ul
            references layer_schema_config
);

alter table layer_schema_config_option
    owner to postgres;

INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (1, 'true', 3);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (2, 'false', 3);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (3, 'true', 4);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (4, 'false', 4);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (5, 'ACTIVE', 5);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (6, 'INACTIVE', 5);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (9, 'number', 2);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (10, 'checkbox', 2);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (11, 'textarea', 2);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (8, 'select', 2);
INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (7, 'text', 2);

create table layer_schema_field
(
    id              bigserial
        primary key,
    input_type      varchar(255),
    name            varchar(255),
    nullable        boolean      not null,
    read_only       boolean      not null,
    status          varchar(255) not null
        constraint layer_schema_field_status_check
            check ((status)::text = ANY
                   (ARRAY [('ACTIVE'::character varying)::text, ('INACTIVE'::character varying)::text, ('DELETED'::character varying)::text])),
    layer_schema_id bigint
        constraint fka7vbpvgnyuwiku9oku0y9qjy5
            references layer_schema,
    sort_order      integer
);

alter table layer_schema_field
    owner to postgres;

INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (63, 'text', 'linkRef', true, false, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (23, 'number', 'waveSpd', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (52, 'checkbox', 'leftLc', true, false, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (47, 'select', 'v2x', true, false, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (44, 'text', 'direction', true, false, 'ACTIVE', 3, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (36, 'number', 'ffSpd', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (37, 'number', 'width', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (64, 'number', 'offset', true, false, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (65, 'number', 'accessTime', true, false, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (62, 'text', 'id', true, true, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (31, 'number', 'numLane', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (60, 'textarea', 'address', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (7, 'number', 'endPoint', true, false, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (4, 'select', 'type', true, false, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (30, 'number', 'layer', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (66, 'textarea', 'coord', true, false, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (69, 'select', 'type', true, false, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (70, 'textarea', 'address', true, false, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (71, 'text', 'center', true, false, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (25, 'number', 'maxSpd', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (61, 'textarea', 'center', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (28, 'number', 'length', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (1, 'select', 'type', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (21, 'number', 'maxVeh', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (24, 'number', 'minSpd', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (26, 'number', 'ffSpd', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (22, 'number', 'qmax', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (20, 'select', 'simType', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (14, 'textarea', 'shape', true, false, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (15, 'text', 'rightLaneId', true, false, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (13, 'text', 'id', true, true, 'ACTIVE', 7, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (12, 'number', 'length', true, false, 'ACTIVE', 7, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (17, 'number', 'numCell', true, false, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (16, 'text', 'leftLaneId', true, false, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (18, 'text', 'id', true, true, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (19, 'textarea', 'shape', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (32, 'text', 'toNode', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (27, 'number', 'width', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (40, 'text', 'toLink', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (3, 'select', 'type', true, false, 'ACTIVE', 3, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (68, 'select', 'transitMode', true, false, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (48, 'number', 'numConnection', true, false, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (51, 'checkbox', 'rightLc', true, false, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (29, 'number', 'stopLine', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (2, 'select', 'turning', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (41, 'number', 'fromLane', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (11, 'number', 'offset', true, false, 'ACTIVE', 7, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (8, 'number', 'initPoint', true, false, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (10, 'text', 'id', true, true, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (58, 'select', 'type', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (54, 'select', 'transitMode', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (42, 'text', 'fromLink', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (9, 'checkbox', 'block', true, false, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (34, 'text', 'id', true, true, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (46, 'text', 'center', true, false, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (45, 'text', 'linkId', true, false, 'ACTIVE', 3, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (43, 'text', 'id', true, true, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (49, 'number', 'numPort', true, false, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (39, 'number', 'toLane', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (38, 'number', 'length', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (50, 'text', 'id', true, true, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (59, 'number', 'parkingLots', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (33, 'text', 'fromNode', true, false, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (55, 'text', 'linkRef', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (53, 'text', 'id', true, true, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (35, 'textarea', 'shape', true, false, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (67, 'text', 'id', true, true, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (56, 'text', 'laneRef', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (57, 'text', 'offset', true, false, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (247, 'textarea', 'lineList', true, false, 'INACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (248, 'text', 'id', false, true, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (249, 'number', 'angle', true, false, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (250, 'number', 'cellId', true, false, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (251, 'number', 'laneRef', true, false, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (252, 'number', 'linkRef', true, false, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (253, 'select', 'markingType', false, false, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (254, 'number', 'offset', true, false, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, status, layer_schema_id, sort_order) VALUES (255, 'textarea', 'coordinates', true, false, 'INACTIVE', 12, null);

create table layer_schema_option
(
    id       bigserial
        primary key,
    value    varchar(255),
    field_id bigint
        constraint fk4cmxwr4so1ptr0w85wu0l5vvn
            references layer_schema_field
);

alter table layer_schema_option
    owner to postgres;

INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (1, 'straight', 1);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (2, 'L', 2);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (3, 'S', 2);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (4, 'R', 2);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (5, 'in', 3);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (6, 'out', 3);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (7, 'terminal', 4);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (8, 'intersection', 4);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (9, 'normal', 4);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (10, 'diverging', 4);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (11, 'merging', 4);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (12, 'garage', 4);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (13, 'curve', 1);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (14, 'Meso', 20);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (15, 'Micro', 20);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (16, 'on', 47);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (17, 'off', 47);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (20, 'test', 1);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (21, 'subway', 68);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (22, 'island', 69);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (23, 'side', 69);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (24, 'Diamond', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (25, 'LeftTurn', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (26, 'RightTurn', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (27, 'Straight', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (28, 'StraightLeft', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (29, 'StraightRight', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (30, 'UTurn', 253);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (31, 'side', 58);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (32, 'island', 58);
INSERT INTO public.layer_schema_option (id, value, field_id) VALUES (33, 'bus', 54);

