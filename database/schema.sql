create table layer_schema
(
    id         bigserial
        primary key,
    name       varchar(255) not null,
    sort_order integer      not null,
    status     varchar(255) not null
        constraint layer_schema_status_check
            check ((status)::text = ANY
                   ((ARRAY ['ACTIVE'::character varying, 'INACTIVE'::character varying, 'DELETED'::character varying])::text[])),
    layer_id   bigint
        constraint fk1nxldm8wy7q7bjgffrdhc67v6
            references layer
);

alter table layer_schema
    owner to postgres;

create table layer_schema_field
(
    id                   bigserial
        primary key,
    input_type           varchar(255),
    name                 varchar(255),
    nullable             boolean      not null,
    read_only            boolean      not null,
    status               varchar(255) not null
        constraint layer_schema_field_status_check
            check ((status)::text = ANY
                   ((ARRAY ['ACTIVE'::character varying, 'INACTIVE'::character varying, 'DELETED'::character varying])::text[])),
    layer_schema_id bigint
        constraint fka7vbpvgnyuwiku9oku0y9qjy5
            references layer_schema
);

alter table layer_schema_field
    owner to postgres;

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



BEGIN;

WITH params AS (
    SELECT 7::bigint AS layer_id  -- 네트워크 레이어 ID
),

-- Node 루트
     node_root AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Node', 0, 'ACTIVE', p.layer_id
             FROM params p
             RETURNING id
     ),
-- Node 하위
     node_port AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Port', 1, 'ACTIVE', p.layer_id
             FROM params p
             RETURNING id
     ),
     node_connection AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Connection', 2, 'ACTIVE', p.layer_id
             FROM params p
             RETURNING id
     ),

-- Link 루트
     link_root AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Link', 10, 'ACTIVE', p.layer_id
             FROM params p
             RETURNING id
     ),
-- Link 하위: Lane
     link_lane AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Lane', 11, 'ACTIVE', p.layer_id
             FROM params p
             RETURNING id
     ),
-- Lane 하위: Cell
     lane_cell AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Cell', 12, 'ACTIVE', p.layer_id
             FROM params p, link_lane ll
             RETURNING id
     ),
-- Lane 하위: Segment
     lane_segment AS (
         INSERT INTO layer_schema (name, sort_order, status, layer_id)
             SELECT 'Segment', 13, 'ACTIVE', p.layer_id
             FROM params p
             RETURNING id
     ),

-- Node 필드
     node_field_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nr.id, 'id', 'text', TRUE, FALSE, 'ACTIVE' FROM node_root nr
             RETURNING id
     ),
     node_field_type AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nr.id, 'type', 'select', FALSE, FALSE, 'ACTIVE' FROM node_root nr
             RETURNING id
     ),
     node_field_num_port AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nr.id, 'num_port', 'number', FALSE, FALSE, 'ACTIVE' FROM node_root nr
             RETURNING id
     ),
     node_field_num_conn AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nr.id, 'num_connection', 'number', FALSE, FALSE, 'ACTIVE' FROM node_root nr
             RETURNING id
     ),
     node_field_v2x AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nr.id, 'v2x', 'text', FALSE, FALSE, 'ACTIVE' FROM node_root nr
             RETURNING id
     ),
     node_field_center AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nr.id, 'center', 'text', FALSE, FALSE, 'ACTIVE' FROM node_root nr
             RETURNING id
     ),

-- Port 필드
     port_field_type AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT np.id, 'type', 'select', FALSE, FALSE, 'ACTIVE' FROM node_port np
             RETURNING id
     ),
     port_field_link_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT np.id, 'link_id', 'text', FALSE, FALSE, 'ACTIVE' FROM node_port np
             RETURNING id
     ),
     port_field_direction AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT np.id, 'direction', 'text', FALSE, FALSE, 'ACTIVE' FROM node_port np
             RETURNING id
     ),

-- Connection 필드
     conn_field_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'id', 'text', TRUE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_from_link AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'from_link', 'text', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_from_lane AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'from_lane', 'number', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_to_link AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'to_link', 'text', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_to_lane AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'to_lane', 'number', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_turning AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'turning', 'select', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_length AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'length', 'number', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_width AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'width', 'number', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_ff_spd AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'ff_spd', 'number', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),
     conn_field_shape AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT nc.id, 'shape', 'textarea', FALSE, FALSE, 'ACTIVE' FROM node_connection nc
             RETURNING id
     ),

-- Link 필드들
     link_field_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'id', 'text', TRUE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_from_node AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'from_node', 'text', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_to_node AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'to_node', 'text', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_num_lane AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'num_lane', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_type AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'type', 'select', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_layer AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'layer', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_stop_line AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'stop_line', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_length AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'length', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_width AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'width', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_ff_spd AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'ff_spd', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_max_spd AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'max_spd', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_min_spd AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'min_spd', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_wave_spd AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'wave_spd', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_qmax AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'qmax', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_max_veh AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'max_veh', 'number', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_sim_type AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'sim_type', 'select', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),
     link_field_shape AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lr.id, 'shape', 'textarea', FALSE, FALSE, 'ACTIVE' FROM link_root lr
             RETURNING id
     ),

-- Lane 필드들
     lane_field_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ll.id, 'id', 'text', TRUE, FALSE, 'ACTIVE' FROM link_lane ll
             RETURNING id
     ),
     lane_field_num_cell AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ll.id, 'num_cell', 'number', FALSE, FALSE, 'ACTIVE' FROM link_lane ll
             RETURNING id
     ),
     lane_field_left_lane_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ll.id, 'left_lane_id', 'text', FALSE, FALSE, 'ACTIVE' FROM link_lane ll
             RETURNING id
     ),
     lane_field_right_lane_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ll.id, 'right_lane_id', 'text', FALSE, FALSE, 'ACTIVE' FROM link_lane ll
             RETURNING id
     ),
     lane_field_shape AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ll.id, 'shape', 'textarea', FALSE, FALSE, 'ACTIVE' FROM link_lane ll
             RETURNING id
     ),

-- Cell 필드들
     cell_field_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lc.id, 'id', 'text', TRUE, FALSE, 'ACTIVE' FROM lane_cell lc
             RETURNING id
     ),
     cell_field_length AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lc.id, 'length', 'number', FALSE, FALSE, 'ACTIVE' FROM lane_cell lc
             RETURNING id
     ),
     cell_field_offset AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT lc.id, 'offset', 'number', FALSE, FALSE, 'ACTIVE' FROM lane_cell lc
             RETURNING id
     ),

-- Segment 필드들
     segment_field_id AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ls.id, 'id', 'text', TRUE, FALSE, 'ACTIVE' FROM lane_segment ls
             RETURNING id
     ),
     segment_field_block AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ls.id, 'block', 'checkbox', FALSE, FALSE, 'ACTIVE' FROM lane_segment ls
             RETURNING id
     ),
     segment_field_init_point AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ls.id, 'init_point', 'number', FALSE, FALSE, 'ACTIVE' FROM lane_segment ls
             RETURNING id
     ),
     segment_field_end_point AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ls.id, 'end_point', 'number', FALSE, FALSE, 'ACTIVE' FROM lane_segment ls
             RETURNING id
     ),
     segment_field_right_lc AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ls.id, 'right_lc', 'text', FALSE, FALSE, 'ACTIVE' FROM lane_segment ls
             RETURNING id
     ),
     segment_field_left_lc AS (
         INSERT INTO layer_schema_field (layer_schema_id, name, input_type, read_only, nullable, status)
             SELECT ls.id, 'left_lc', 'text', FALSE, FALSE, 'ACTIVE' FROM lane_segment ls
             RETURNING id
     ),

-- Node.type
     ins_node_type_options AS (
         INSERT INTO layer_schema_option (field_id, value)
             SELECT (SELECT id FROM node_field_type), v
             FROM (VALUES ('terminal'),('intersection'),('normal'),('diverging'),('merging'),('garage')) AS t(v)
             RETURNING 1
     ),
-- Port.type
     ins_port_type_options AS (
         INSERT INTO layer_schema_option (field_id, value)
             SELECT (SELECT id FROM port_field_type), v
             FROM (VALUES ('in'),('out')) AS t(v)
             RETURNING 1
     ),
-- Connection.turning
     ins_conn_turning_options AS (
         INSERT INTO layer_schema_option (field_id, value)
             SELECT (SELECT id FROM conn_field_turning), v
             FROM (VALUES ('L'),('S'),('R')) AS t(v)
             RETURNING 1
     ),
-- Link.type
     ins_link_type_options AS (
         INSERT INTO layer_schema_option (field_id, value)
             SELECT (SELECT id FROM link_field_type), v
             FROM (VALUES ('straight')) AS t(v)
             RETURNING 1
     )

SELECT 1;

COMMIT;
