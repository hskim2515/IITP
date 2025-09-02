-- Table: public.layer_col_scheme

-- DROP TABLE IF EXISTS public.layer_col_scheme;

CREATE TABLE IF NOT EXISTS public.layer_col_scheme
(
    id bigint NOT NULL DEFAULT nextval('layer_col_scheme_id_seq'::regclass),
    row_key character varying(255) COLLATE pg_catalog."default",
    layer_key character varying(255) COLLATE pg_catalog."default",
    key character varying(255) COLLATE pg_catalog."default",
    readonly boolean,
    type character varying(255) COLLATE pg_catalog."default",
    options text[] COLLATE pg_catalog."default",
    CONSTRAINT layer_col_scheme_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.layer_col_scheme
    OWNER to postgres;



INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'id', true, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'fromNode', true, 'text', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'toNode', true, 'text', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'ffSpd', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'maxSpd', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'minSpd', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'maxVeh', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'qmax', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'waveSpd', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'length', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'numLane', true, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'width', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'stopLine', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'type', false, 'select', ARRAY['straight']);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'simType', false, 'number', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'shape', true, 'text', NULL);

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('link', 'network', 'layer', true, 'text', NULL);


INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('lane', 'network', 'id', true, 'text', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('lane', 'network', 'numCell', true, 'number', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('lane', 'network', 'leftLaneId', true, 'text', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('lane', 'network', 'rightLaneId', true, 'text', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('lane', 'network', 'shape', true, 'text', NULL);


INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('cell', 'network', 'id', true, 'text', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('cell', 'network', 'length', false, 'number', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('cell', 'network', 'offset', false, 'number', NULL);



INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('segment', 'network', 'id', true, 'text', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('segment', 'network', 'block', false, 'boolean', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('segment', 'network', 'initPoint', false, 'number', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('segment', 'network', 'endPoint', false, 'number', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('segment', 'network', 'leftLc', false, 'text', NULL);
INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options)
VALUES ('segment', 'network', 'rightLc', false, 'text', NULL);


INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options) VALUES
                                                                                    ('nodes', 'network', 'id', true, 'text', NULL),
                                                                                    ('nodes', 'network', 'center', true, 'text', NULL),
                                                                                    ('nodes', 'network', 'numConnection', true, 'number', NULL),
                                                                                    ('nodes', 'network', 'numPort', true, 'number', NULL),
                                                                                    ('nodes', 'network', 'type', false, 'select', ARRAY['intersection', 'terminal', 'normal', 'merging', 'diverging', 'garage']);


INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options) VALUES
                                                                                    ('connections', 'network', 'id', true, 'text', NULL),
                                                                                    ('connections', 'network', 'fromLink', true, 'text', NULL),
                                                                                    ('connections', 'network', 'fromLane', true, 'number', NULL),
                                                                                    ('connections', 'network', 'toLink', true, 'text', NULL),
                                                                                    ('connections', 'network', 'toLane', true, 'number', NULL),
                                                                                    ('connections', 'network', 'ffSpd', false, 'number', NULL),
                                                                                    ('connections', 'network', 'length', true, 'number', NULL),
                                                                                    ('connections', 'network', 'width', false, 'number', NULL),
                                                                                    ('connections', 'network', 'shape', true, 'text', NULL),
                                                                                    ('connections', 'network', 'turning', false, 'select', ARRAY['S','L','R','U']);


INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options) VALUES
                                                                                    ('ports', 'network', 'linkId', true, 'text', NULL),
                                                                                    ('ports', 'network', 'type', true, 'select', ARRAY['in','out']),
                                                                                    ('ports', 'network', 'direction', true, 'text', NULL);