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
INSERT INTO public.layer_schema (id, name, sort_order, status, layer_id) VALUES (13, 'signals', 0, 'ACTIVE', 8);

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
    sort_order      integer,
    status          varchar(255) not null
        constraint layer_schema_field_status_check
            check ((status)::text = ANY
                   ((ARRAY ['ACTIVE'::character varying, 'INACTIVE'::character varying, 'DELETED'::character varying])::text[])),
    layer_schema_id bigint
        constraint fkatyfeurply6eojovv6qyxpp5e
            references layer_schema,
    default_value   varchar(255)
);

alter table layer_schema_field
    owner to postgres;

INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (259, 'text', 'type', true, false, null, 'ACTIVE', 13, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (258, 'text', 'turning', true, false, null, 'ACTIVE', 13, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (257, 'number', 'connectionId', true, false, null, 'ACTIVE', 13, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (256, 'number', 'nodeId', true, false, null, 'ACTIVE', 13, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (255, 'text', 'coordinates', true, false, null, 'INACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (254, 'number', 'offset', true, false, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (253, 'select', 'markingType', false, false, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (252, 'number', 'linkRef', true, false, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (251, 'number', 'laneRef', true, false, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (250, 'number', 'cellId', true, false, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (249, 'number', 'angle', true, false, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (248, 'text', 'id', false, true, null, 'ACTIVE', 12, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (247, 'textarea', 'lineList', true, false, null, 'INACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (92, 'text', 'featureType', false, false, null, 'INACTIVE', 6, 'lanes');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (91, 'text', 'featureType', false, false, null, 'INACTIVE', 2, 'connections');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (90, 'text', 'featureType', false, false, null, 'INACTIVE', 5, 'segments');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (89, 'text', 'featureType', false, false, null, 'INACTIVE', 7, 'cells');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (88, 'text', 'featureType', false, false, null, 'INACTIVE', 3, 'ports');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (87, 'text', 'featureType', false, false, null, 'INACTIVE', 4, 'nodes');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (86, 'text', 'featureType', false, false, null, 'INACTIVE', 1, 'links');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (71, 'text', 'center', true, false, null, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (70, 'textarea', 'address', true, false, null, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (69, 'select', 'type', true, false, null, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (68, 'select', 'transitMode', true, false, null, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (67, 'text', 'id', true, true, null, 'ACTIVE', 9, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (66, 'textarea', 'coord', true, false, null, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (65, 'number', 'accessTime', true, false, null, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (64, 'number', 'offset', true, false, null, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (63, 'text', 'linkRef', true, false, null, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (62, 'text', 'id', true, true, null, 'ACTIVE', 10, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (61, 'textarea', 'center', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (60, 'textarea', 'address', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (59, 'number', 'parkingLots', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (58, 'select', 'type', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (57, 'number', 'offset', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (56, 'text', 'laneRef', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (55, 'text', 'linkRef', true, false, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (54, 'select', 'transitMode', true, false, null, 'ACTIVE', 8, 'bus');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (53, 'text', 'id', true, true, null, 'ACTIVE', 8, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (52, 'checkbox', 'leftLc', true, false, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (51, 'checkbox', 'rightLc', true, false, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (50, 'text', 'id', true, true, null, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (49, 'number', 'numPort', true, false, null, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (48, 'number', 'numConnection', true, false, null, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (47, 'select', 'v2x', true, false, null, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (46, 'text', 'center', true, false, null, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (45, 'text', 'linkId', true, false, null, 'ACTIVE', 3, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (44, 'text', 'direction', true, false, null, 'ACTIVE', 3, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (43, 'text', 'id', true, true, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (42, 'text', 'fromLink', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (41, 'number', 'fromLane', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (40, 'text', 'toLink', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (39, 'number', 'toLane', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (38, 'number', 'length', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (37, 'number', 'width', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (36, 'number', 'ffSpd', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (35, 'textarea', 'shape', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (34, 'text', 'id', true, true, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (33, 'text', 'fromNode', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (32, 'text', 'toNode', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (31, 'number', 'numLane', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (30, 'number', 'layer', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (29, 'number', 'stopLine', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (28, 'number', 'length', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (27, 'number', 'width', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (26, 'number', 'ffSpd', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (25, 'number', 'maxSpd', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (24, 'number', 'minSpd', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (23, 'number', 'waveSpd', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (22, 'number', 'qmax', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (21, 'number', 'maxVeh', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (20, 'select', 'simType', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (19, 'textarea', 'shape', true, false, null, 'ACTIVE', 1, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (18, 'text', 'id', true, true, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (17, 'number', 'numCell', true, false, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (16, 'text', 'leftLaneId', true, false, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (15, 'text', 'rightLaneId', true, false, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (14, 'textarea', 'shape', true, false, null, 'ACTIVE', 6, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (13, 'text', 'id', true, true, null, 'ACTIVE', 7, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (12, 'number', 'length', true, false, null, 'ACTIVE', 7, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (11, 'number', 'offset', true, false, null, 'ACTIVE', 7, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (10, 'text', 'id', true, true, null, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (9, 'checkbox', 'block', true, false, null, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (8, 'number', 'initPoint', true, false, null, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (7, 'number', 'endPoint', true, false, null, 'ACTIVE', 5, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (6, 'text', 'featureType', false, true, null, 'INACTIVE', 8, 'busStations');
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (4, 'select', 'type', true, false, null, 'ACTIVE', 4, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (3, 'select', 'type', true, false, null, 'ACTIVE', 3, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (2, 'select', 'turning', true, false, null, 'ACTIVE', 2, null);
INSERT INTO public.layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES (1, 'select', 'type', true, false, null, 'ACTIVE', 1, null);

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

insert into layer_schema_config (id, config_key, input_type, sort_order)
values (7,'defaultValue', 'text',7);



