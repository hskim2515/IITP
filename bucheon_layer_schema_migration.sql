-- ============================================================
-- Layer Schema Migration for new layers
-- Layer IDs:
--   18 = busRoute
--   19 = railRoute
--   25 = busRouteWeekday
--   26 = busRouteWeekend
--   27 = signalTod
--   28 = route
--   29 = paxRoute
-- ============================================================

-- ============================================================
-- busRoute (layer_id = 18) — BusPtLinesXml
--   Root: lines → [ LineXml: id, interval ]
--   Child: seqs  → [ SeqXml: seq ] (link/node/station/garage 공유)
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (18, 'lines', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'id',       1, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 18 AND name = 'lines';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'interval', 2, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 18 AND name = 'lines';

INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (18, 'seqs', 2, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'seq', 1, 'text', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 18 AND name = 'seqs';

-- ============================================================
-- busRouteWeekday (layer_id = 25) — 동일 구조
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (25, 'lines', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'id',       1, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 25 AND name = 'lines';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'interval', 2, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 25 AND name = 'lines';

INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (25, 'seqs', 2, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'seq', 1, 'text', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 25 AND name = 'seqs';

-- ============================================================
-- busRouteWeekend (layer_id = 26) — 동일 구조
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (26, 'lines', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'id',       1, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 26 AND name = 'lines';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'interval', 2, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 26 AND name = 'lines';

INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (26, 'seqs', 2, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'seq', 1, 'text', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 26 AND name = 'seqs';

-- ============================================================
-- railRoute (layer_id = 19) — RailPtLineXml
--   Root: routes → [ RouteXml: id, name, railStationSeq ]
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (19, 'routes', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'id',             1, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 19 AND name = 'routes';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'name',           2, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 19 AND name = 'routes';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'railStationSeq', 3, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 19 AND name = 'routes';

-- ============================================================
-- signalTod (layer_id = 27) — SignalTodXml
--   Root: nodes → [ NodeXml: id ]
--   Child: plans → [ PlanXml: id, startTime, endTime ]
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (27, 'nodes', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'id', 1, 'text', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 27 AND name = 'nodes';

INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (27, 'plans', 2, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'id',        1, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 27 AND name = 'plans';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'startTime', 2, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 27 AND name = 'plans';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'endTime',   3, 'text',   false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 27 AND name = 'plans';

-- ============================================================
-- route (layer_id = 28) — Route.json
--   Root: Route → [ { OriginID, DestinationID } ]
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (28, 'Route', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'OriginID',      1, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 28 AND name = 'Route';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'DestinationID', 2, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 28 AND name = 'Route';

-- ============================================================
-- paxRoute (layer_id = 29) — PaxRoute.json
--   Root: PaxRoute → [ { OriginID, DestinationID } ]
-- ============================================================
INSERT INTO layer_schema (layer_id, name, sort_order, status)
VALUES (29, 'PaxRoute', 1, 'ACTIVE');

INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'OriginID',      1, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 29 AND name = 'PaxRoute';
INSERT INTO layer_schema_field (layer_schema_id, name, sort_order, input_type, read_only, nullable, status)
SELECT id, 'DestinationID', 2, 'number', false, true, 'ACTIVE' FROM layer_schema WHERE layer_id = 29 AND name = 'PaxRoute';
