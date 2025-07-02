--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4 (Debian 17.4-1.pgdg120+2)
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: pavement_marking_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pavement_marking_logs (
    id bigint NOT NULL,
    created_at character varying(255) DEFAULT now(),
    data jsonb NOT NULL,
    version_id character varying(255) NOT NULL
);


ALTER TABLE public.pavement_marking_logs OWNER TO postgres;

--
-- Name: pavement_marking_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pavement_marking_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pavement_marking_logs_id_seq OWNER TO postgres;

--
-- Name: pavement_marking_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pavement_marking_logs_id_seq OWNED BY public.pavement_marking_logs.id;


--
-- Name: pavement_marking_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pavement_marking_versions (
    id bigint NOT NULL,
    version_id character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    data jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.pavement_marking_versions OWNER TO postgres;

--
-- Name: pavement_marking_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pavement_marking_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pavement_marking_versions_id_seq OWNER TO postgres;

--
-- Name: pavement_marking_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pavement_marking_versions_id_seq OWNED BY public.pavement_marking_versions.id;


--
-- Name: pavement_marking_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pavement_marking_logs ALTER COLUMN id SET DEFAULT nextval('public.pavement_marking_logs_id_seq'::regclass);


--
-- Name: pavement_marking_versions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pavement_marking_versions ALTER COLUMN id SET DEFAULT nextval('public.pavement_marking_versions_id_seq'::regclass);


--
-- Data for Name: pavement_marking_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.pavement_marking_logs (id, created_at, data, version_id) VALUES (170, '2025-06-30T05:13:28.411Z', '{"added": [{"field": "id", "newValue": 1751260408406, "oldValue": null, "featureId": 1751260408406}, {"field": "selected", "newValue": 1, "oldValue": null, "featureId": 1751260408406}, {"field": "markingType", "newValue": "Diamond", "oldValue": null, "featureId": 1751260408406}, {"field": "linkRef", "newValue": 20001245, "oldValue": null, "featureId": 1751260408406}, {"field": "laneRef", "newValue": 2, "oldValue": null, "featureId": 1751260408406}, {"field": "cellId", "newValue": 0, "oldValue": null, "featureId": 1751260408406}, {"field": "offset", "newValue": 0, "oldValue": null, "featureId": 1751260408406}, {"field": "angle", "newValue": -1.4027025575010406, "oldValue": null, "featureId": 1751260408406}]}', 'scenario1');
INSERT INTO public.pavement_marking_logs (id, created_at, data, version_id) VALUES (171, '2025-06-30T05:13:37.324Z', '{"modified": [{"field": "laneRef", "newValue": 1, "oldValue": 2, "featureId": 1751260408406}]}', 'scenario1');
INSERT INTO public.pavement_marking_logs (id, created_at, data, version_id) VALUES (172, '2025-06-30T05:13:38.136Z', '{"modified": [{"field": "cellId", "newValue": 1, "oldValue": 0, "featureId": 1751260408406}]}', 'scenario1');
INSERT INTO public.pavement_marking_logs (id, created_at, data, version_id) VALUES (173, '2025-06-30T05:13:40.589Z', '{"modified": [{"field": "offset", "newValue": "1", "oldValue": 0, "featureId": 1751260408406}]}', 'scenario1');
INSERT INTO public.pavement_marking_logs (id, created_at, data, version_id) VALUES (174, '2025-06-30T05:13:42.673Z', '{"modified": [{"field": "linkRef", "newValue": "20001309", "oldValue": 20001309, "featureId": 1750831017542}]}', 'scenario1');
INSERT INTO public.pavement_marking_logs (id, created_at, data, version_id) VALUES (175, '2025-06-30T05:13:44.893Z', '{"deleted": [{"field": "id", "newValue": null, "oldValue": 1751260408406, "featureId": 1751260408406}, {"field": "markingType", "newValue": null, "oldValue": "Diamond", "featureId": 1751260408406}, {"field": "linkRef", "newValue": null, "oldValue": 20001245, "featureId": 1751260408406}, {"field": "laneRef", "newValue": null, "oldValue": 1, "featureId": 1751260408406}, {"field": "cellId", "newValue": null, "oldValue": 1, "featureId": 1751260408406}, {"field": "offset", "newValue": null, "oldValue": "1", "featureId": 1751260408406}, {"field": "angle", "newValue": null, "oldValue": -1.4027025575010406, "featureId": 1751260408406}]}', 'scenario1');


--
-- Data for Name: pavement_marking_versions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.pavement_marking_versions (id, version_id, created_at, data, updated_at) VALUES (2, 'scenario2', '2025-06-23 02:25:57.599028', '{"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": "1001", "angle": 0, "cellId": 10, "offset": 0, "laneRef": 1, "linkRef": "3001001", "markingType": "Straight"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": "1002", "angle": 0, "cellId": 20, "offset": 5.5, "laneRef": 2, "linkRef": "3001002", "markingType": "Straight"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": "1003", "angle": 0, "cellId": 15, "offset": 10.2, "laneRef": 1, "linkRef": "3001003", "markingType": "Straight"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": "1004", "angle": 0, "cellId": 18, "offset": 3.3, "laneRef": 3, "linkRef": "3001004", "markingType": "Straight"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": "1005", "angle": 0, "cellId": 12, "offset": 7.8, "laneRef": 1, "linkRef": "3001005", "markingType": "Straight"}}]}', '2025-06-24 09:47:01.042292');
INSERT INTO public.pavement_marking_versions (id, version_id, created_at, data, updated_at) VALUES (1, 'scenario1', '2025-06-23 02:25:57.599028', '{"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.75321650562542, 37.50619234679415]}, "properties": {"id": "1001", "lat": 37.506157245494904, "lon": 126.75320878868936, "angle": 0.17266576076186524, "cellId": 0, "offset": "5", "laneRef": 2, "linkRef": "20000402", "selected": 0, "markingType": "Straight", "geometryType": "Point"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.75318553211031, 37.50619663201847]}, "properties": {"id": 1750814399034, "lat": 37.506264099532345, "lon": 126.75316844908006, "angle": 0.17266576076186524, "cellId": 0, "offset": "5", "laneRef": 1, "linkRef": "20000402", "selected": 0, "markingType": "Diamond", "geometryType": "Point"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.7681450025, 37.49649358945946]}, "properties": {"id": 1750830555229, "lat": 37.49649358945946, "lon": 126.7681450025, "angle": 0.14813082871499528, "cellId": null, "offset": 0, "laneRef": 1, "linkRef": "20001429", "selected": 0, "markingType": "Diamond", "geometryType": "Point"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.76825104868371, 37.49722642611131]}, "properties": {"id": 1750830822519, "lat": 37.49722642611131, "lon": 126.76825104868371, "angle": 0.14813082871499528, "cellId": 1, "offset": "35", "laneRef": 0, "linkRef": 20001429, "selected": 0, "markingType": "Diamond", "geometryType": "Point"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.76870314850186, 37.49947796079866]}, "properties": {"id": 1750830930836, "angle": -2.9743192709772153, "cellId": 0, "offset": 69, "laneRef": 0, "linkRef": 20001522, "selected": 0, "markingType": "Diamond"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.76854104569249, 37.49852807866648]}, "properties": {"id": 1750831017542, "lat": 37.49852807866648, "lon": 126.76854104569249, "angle": 0.17023173980534914, "cellId": 0, "offset": 14, "laneRef": 0, "linkRef": "20001309", "selected": 0, "markingType": "Diamond", "geometryType": "Point"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [126.76853952384987, 37.498521054727675]}, "properties": {"id": 1750831019869, "angle": 0.17023173980534914, "cellId": 0, "offset": 13, "laneRef": 0, "linkRef": 20001309, "selected": 0, "markingType": "Diamond"}}]}', '2025-06-24 09:47:01.042292');


--
-- Name: pavement_marking_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pavement_marking_logs_id_seq', 175, true);


--
-- Name: pavement_marking_versions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pavement_marking_versions_id_seq', 1, true);


--
-- Name: pavement_marking_logs pavement_marking_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pavement_marking_logs
    ADD CONSTRAINT pavement_marking_logs_pkey PRIMARY KEY (id);


--
-- Name: pavement_marking_versions pavement_marking_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pavement_marking_versions
    ADD CONSTRAINT pavement_marking_versions_pkey PRIMARY KEY (id);


--
-- Name: pavement_marking_versions uq_version_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pavement_marking_versions
    ADD CONSTRAINT uq_version_id UNIQUE (version_id);


--
-- PostgreSQL database dump complete
--

