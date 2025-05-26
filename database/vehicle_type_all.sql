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
-- Name: vehicle_type; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_type (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    v2x character varying(255) DEFAULT 'off'::bpchar,
    drt character varying(255) DEFAULT '0'::bpchar,
    max_pax character varying(255) DEFAULT 1,
    vehicle_id character varying(255)
);

ALTER TABLE public.vehicle_type OWNER TO postgres;

--
-- Name: vehicle_type_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vehicle_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vehicle_type_id_seq OWNER TO postgres;

--
-- Name: vehicle_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vehicle_type_id_seq OWNED BY public.vehicle_type.id;

--
-- Name: vehicle_type_model_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vehicle_type_model_id_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vehicle_type_model_id_seq OWNER TO postgres;

--
-- Name: vehicle_type_model_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vehicle_type_model_id_seq OWNED BY public.vehicle_type_model.id;

--
-- Name: vehicle_type_model; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_type_model (
    id bigint DEFAULT nextval('public.vehicle_type_model_id_seq'::regclass) NOT NULL,
    color character varying(255),
    file_name character varying(255),
    file_path character varying(255),
    name character varying(255),
    length character varying(255),
    vehicle_type_id bigint
);

ALTER TABLE public.vehicle_type_model OWNER TO postgres;

--
-- Name: vehicle_type_parameter; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_type_parameter (
    id bigint DEFAULT nextval('public.vehicle_type_parameter_id_seq'::regclass) NOT NULL,
    vehicle_type_id bigint NOT NULL,
    parameter_name character varying(255) NOT NULL,
    mean character varying(255),
    sd character varying(255),
    min character varying(255),
    max character varying(255),
    dist character varying(255)
);

ALTER TABLE public.vehicle_type_parameter OWNER TO postgres;

--
-- Name: vehicle_type_parameter_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vehicle_type_parameter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vehicle_type_parameter_id_seq OWNER TO postgres;

--
-- Name: vehicle_type_parameter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vehicle_type_parameter_id_seq OWNED BY public.vehicle_type_parameter.id;

--
-- Name: vehicle_type id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type ALTER COLUMN id SET DEFAULT nextval('public.vehicle_type_id_seq'::regclass);

--
-- Data for Name: vehicle_type; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.vehicle_type VALUES (2, 'Taxi', 'off', '1', '3', NULL);
INSERT INTO public.vehicle_type VALUES (11, 'Car', 'of', 'off', '5', NULL);

--
-- Data for Name: vehicle_type_model; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.vehicle_type_model VALUES (26, '#763131', 'CesiumMilkTruck.glb', '/models/CesiumMilkTruck.glb', 'Bus', '12', NULL);
INSERT INTO public.vehicle_type_model VALUES (25, '#ef0000', 'CesiumMilkTruck3.glb', '/models/CesiumMilkTruck3.glb', 'Taxi', '111', NULL);

--
-- Data for Name: vehicle_type_parameter; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.vehicle_type_parameter VALUES (172, 2, 'veh_len', '4.51', '0.2', '4', '5', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (173, 2, 'jamgap', '1.51', '0.2', '1', '2', 'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (174, 2, 'vf', '1101', '10', '90', '130', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (175, 2, 'reaction_time', '1.21', '0.1', '1', '1.5', 'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (176, 2, 'max_acc', '3', '0.5', '2.5', '3.5', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (177, 2, 'max_dec', '-5', '0.3', '-6', '-4', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (178, 2, 'lc_param1', '0.015', '0.01', '0.005', '0.03', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (179, 2, 'lc_param2', '0.045', '0.015', '0.02', '0.07', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (180, 2, 'lc_sensitivity', '0.0025', '1.5', '0.001', '0.05', 'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (181, 11, 'veh_len', '112', '122', '1', '1', '1');
INSERT INTO public.vehicle_type_parameter VALUES (182, 11, 'jamgap', '1', '122', '1', '1', '1');
INSERT INTO public.vehicle_type_parameter VALUES (183, 11, 'vf', '1', '1', '222', '2', '2');
INSERT INTO public.vehicle_type_parameter VALUES (184, 11, 'reaction_time', '1', '1', '2', '2222', '2');
INSERT INTO public.vehicle_type_parameter VALUES (185, 11, 'max_acc', '1', '2', '2', '2', '222');
INSERT INTO public.vehicle_type_parameter VALUES (186, 11, 'max_dec', '1', '2', '2', '2', '2');
INSERT INTO public.vehicle_type_parameter VALUES (187, 11, 'lc_param1', '1', '2', '2', '2', '2');
INSERT INTO public.vehicle_type_parameter VALUES (188, 11, 'lc_param2', '1', '2', '2', '2', '2');
INSERT INTO public.vehicle_type_parameter VALUES (189, 11, 'lc_sensitivity', '1', '2', '2', '2', '2');

--
-- Name: vehicle_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicle_type_id_seq', 13, true);

--
-- Name: vehicle_type_parameter_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicle_type_parameter_id_seq', 18, true);

--
-- Name: vehicle_type_model vehicle_type_model_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type_model
    ADD CONSTRAINT vehicle_type_model_pkey PRIMARY KEY (id);

--
-- Name: vehicle_type_parameter vehicle_type_parameter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type_parameter
    ADD CONSTRAINT vehicle_type_parameter_pkey PRIMARY KEY (id);

--
-- Name: vehicle_type vehicle_type_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type
    ADD CONSTRAINT vehicle_type_pkey PRIMARY KEY (id);

--
-- Name: vehicle_type_parameter fk_vehicle_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type_parameter
    ADD CONSTRAINT fk_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_type(id);

--
-- Name: vehicle_type_parameter vehicle_type_parameter_vehicle_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type_parameter
    ADD CONSTRAINT vehicle_type_parameter_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_type(id);

--
-- Name: vehicle_type_model vehicle_type_model_vehicle_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_type_model
    ADD CONSTRAINT vehicle_type_model_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_type(id);
